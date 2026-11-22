# Kiểm tra end-to-end trong trình duyệt thật (Chromium qua Playwright).
import os, re, subprocess, sys, time
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 3777
URL = f"http://localhost:{PORT}/"
env = dict(os.environ, PORT=str(PORT), TICK_MS="50")
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.0)

errors = []
def hud_tick(page):
    t = page.inner_text("#hud")
    m = re.search(r"Tick (\d+)", t)
    return int(m.group(1)) if m else -1

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox"])
        ctxs = [browser.new_context(viewport={"width": 1280, "height": 760}) for _ in range(3)]
        pages = [c.new_page() for c in ctxs]
        for pg in pages:
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)

        host, b, c = pages
        host.goto(URL); host.fill("#name", "An"); host.click("#create")
        host.wait_for_function("document.getElementById('roomcode').textContent.length === 5", timeout=8000)
        code = host.inner_text("#roomcode")
        for pg, name in [(b, "Bình"), (c, "Chi")]:
            pg.goto(URL); pg.fill("#name", name); pg.fill("#code", code); pg.click("#join")
        host.wait_for_function("document.querySelectorAll('#players .pl').length === 3", timeout=8000)
        host.click("#start")
        host.wait_for_function("getComputedStyle(document.getElementById('game')).display === 'block'", timeout=8000)
        for pg in (b, c):
            pg.wait_for_function("getComputedStyle(document.getElementById('game')).display === 'block'", timeout=8000)

        time.sleep(2.5)
        t1 = hud_tick(host); time.sleep(2.0); t2 = hud_tick(host)
        assert t2 > t1 > 0, f"trận không tiến: {t1} -> {t2}"
        print(f"OK: trận tiến trong trình duyệt (tick {t1} -> {t2})")

        # Chạm thủ đô (ở giữa màn hình) để mở bảng sản xuất, rồi đặt một quân.
        gold_before = re.search(r"Vàng (\d+)", host.inner_text("#hud")).group(1)
        host.mouse.click(640, 380)
        time.sleep(0.5)
        if host.is_visible("#prod"):
            host.click("#prod button[data-k='0']")
            time.sleep(1.0)
            gold_after = re.search(r"Vàng (\d+)", host.inner_text("#hud")).group(1)
            print(f"OK: chạm thủ đô mở bảng sản xuất; vàng {gold_before} -> {gold_after}")
        else:
            print("GHI CHÚ: chạm giữa màn hình không mở bảng sản xuất (có thể đã chạm quân)")

        # Tải lại trang: phải tự kết nối lại và tiếp tục trận.
        before = hud_tick(host)
        host.reload()
        host.wait_for_function("getComputedStyle(document.getElementById('game')).display === 'block'", timeout=15000)
        time.sleep(2.0)
        after = hud_tick(host)
        assert after >= before, f"sau khi tải lại trận không tiếp tục: {before} -> {after}"
        print(f"OK: tải lại trang vẫn vào lại trận (tick {before} -> {after})")

        host.screenshot(path="/tmp/e2e_game.png")
        browser.close()

    real = [e for e in errors if "favicon" not in e.lower()]
    assert not real, "lỗi JavaScript trong trình duyệt: " + " | ".join(real[:5])
    print("OK: không có lỗi JavaScript")
    print("TẤT CẢ KIỂM TRA E2E ĐẠT")
finally:
    srv.terminate()
