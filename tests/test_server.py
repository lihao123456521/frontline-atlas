"""Real HTTP regressions for browser parallel/pre-opened connections.

Run with: python -B -m unittest discover -s tests -p test_server.py -v
"""
import concurrent.futures
import functools
import importlib.util
import pathlib
import re
import socket
import socketserver
import threading
import unittest
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("hoi_dev_server", ROOT / "server.py")
DEV_SERVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEV_SERVER)


class ServerConnectionsTest(unittest.TestCase):
    def setUp(self):
        self.accepted = threading.Event()
        accepted = self.accepted

        class ObservedHandler(DEV_SERVER.Handler):
            def setup(self):
                super().setup()
                accepted.set()

        # The fallback also reproduces the original single-thread configuration.
        server_type = getattr(DEV_SERVER, "Server", socketserver.TCPServer)
        self.server = server_type(
            ("127.0.0.1", 0), functools.partial(ObservedHandler, directory=str(ROOT))
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True
        )
        self.thread.start()
        self.base = "http://127.0.0.1:" + str(self.server.server_address[1])
        self.idle = None

    def tearDown(self):
        if self.idle is not None:
            self.idle.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def get(self, relative, timeout=2):
        with urllib.request.urlopen(self.base + "/" + relative + "?cold-test=1", timeout=timeout) as response:
            actual = response.read()
            self.assertEqual(response.status, 200)
            self.assertEqual(actual, (ROOT / relative).read_bytes())
            self.assertIn("no-store", response.headers["Cache-Control"])
            return len(actual)

    def test_idle_preopened_connection_does_not_block_a_script(self):
        # Browsers may pre-open a connection before sending an HTTP request.
        self.idle = socket.create_connection(self.server.server_address, timeout=2)
        self.assertTrue(self.accepted.wait(timeout=2), "idle socket must be accepted first")
        self.assertGreater(self.get("js/map.js"), 1000)

    def test_parallel_assets_are_complete_and_uncached(self):
        assets = [
            "js/data.js", "js/data_world.js", "js/data_provinces.js",
            "js/data_historical_map.js", "js/data_world_historical.js",
            "js/history.js", "js/world.js", "js/campaign.js", "js/order_of_battle.js", "js/game.js",
            "js/map.js", "js/ui.js", "js/main.js", "js/runtime.js",
            "css/war-command.css",
        ]
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(self.get, assets))
        self.assertEqual(len(results), len(assets))
        self.assertTrue(all(size > 0 for size in results))

    def test_entire_page_asset_burst_fits_the_connection_backlog(self):
        assets = re.findall(r'(?:src|href)="((?:js|css)/[^"?]+)', (ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertGreaterEqual(len(assets), 35)
        self.assertGreaterEqual(self.server.request_queue_size, len(assets))
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(assets)) as pool:
            results = list(pool.map(lambda asset: self.get(asset, timeout=10), assets))
        self.assertEqual(len(results), len(assets))
        self.assertTrue(all(size > 0 for size in results))

    def test_second_server_cannot_silently_share_the_same_listener(self):
        with self.assertRaises(OSError):
            duplicate = DEV_SERVER.Server(self.server.server_address, DEV_SERVER.Handler)
            duplicate.server_close()


if __name__ == "__main__":
    unittest.main()
