"""Optional rendered regression suite; requires Python Playwright and Chromium."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
ENGINE = os.environ.get('NMNM_UI_BROWSER', 'chromium')
FIXTURE = """
import { startServer } from './packages/nmnm-ui/src/server.js';
import { open } from './packages/nmnm-core/src/index.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
const config = join(process.env.HOME, '.local/share/nanomneme');
mkdirSync(config, {recursive:true});
writeFileSync(join(config, 'config.jsonc'), JSON.stringify({logging:{enabled:true}}));
const path = join(process.env.NMNM_UI_TEST_DIR, 'memory.db');
mkdirSync(join(process.env.NMNM_UI_TEST_DIR, 'nested'));
writeFileSync(join(process.env.NMNM_UI_TEST_DIR, 'invalid.db'), 'not a database');
const db = open(path);
db.retain({content:'<script>window.injected=true</script> Captured preference',kind:'preference',metadata:{source:'pi'}});
db.retain({content:'Recorded unknown',metadata:{source:'unknown'}});
db.retain({content:'Expired decision',expires_at:'2000-01-01T00:00:00.000Z'});
const removed = db.retain({content:'Removed note'}); db.remove({id:removed.id}); db.close();
const scrolling = open(path); for (let index = 0; index < 6; index++) scrolling.retain({content:'Scroll fixture ' + index,metadata:{source:'scroll-fixture'}}); scrolling.close();
const app = await startServer({cwd:process.env.NMNM_UI_TEST_DIR});
console.log(JSON.stringify({url:app.url,path}));
process.on('SIGTERM',async()=>{await app.close()});
"""

with tempfile.TemporaryDirectory(prefix="nmnm-ui-browser-") as directory:
    env = {**os.environ, "NMNM_UI_TEST_DIR": directory, "HOME": directory}
    server = subprocess.Popen(["node", "--input-type=module", "-e", FIXTURE], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        fixture = json.loads(server.stdout.readline())
        with sync_playwright() as playwright:
            browser = getattr(playwright, ENGINE).launch(headless=True)
            page = browser.new_page(viewport={"width": 1440, "height": 1000})
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(fixture["url"])
            page.wait_for_load_state("networkidle")
            with page.expect_response("**/api/error") as reported:
                page.evaluate("window.dispatchEvent(new ErrorEvent('error', {error:new Error('Browser diagnostic smoke')}))")
            assert reported.value.status == 200
            log = Path(directory) / ".local/share/nanomneme/logs/nmnm-ui.jsonl"
            records = [json.loads(line) for line in log.read_text().splitlines()]
            assert records[0]["event"] == "ui.error"
            assert records[0]["error"]["message"] == "Browser diagnostic smoke"
            version = json.loads((ROOT / "packages/nmnm-ui/package.json").read_text())["version"]
            expect(page.locator("header .brand span")).to_have_text(f"memory workbench {version}")
            if ENGINE == 'webkit':
                # WebKit's link tabbing depends on platform keyboard settings.
                page.get_by_role("link", name="Skip to memories").focus()
            else:
                page.keyboard.press("Tab")
            expect(page.get_by_role("link", name="Skip to memories")).to_be_focused()
            page.get_by_role("button", name="Switch to light theme").focus()
            page.keyboard.press("Enter")
            expect(page.locator("html")).to_have_attribute("data-theme", "light")
            expect(page.locator("#theme-moon")).to_be_visible()
            expect(page.locator("#theme-sun")).to_be_hidden()
            page.keyboard.press("Enter")
            expect(page.locator("html")).to_have_attribute("data-theme", "dark")
            expect(page.locator("#theme-sun")).to_be_visible()
            expect(page.locator("#stores-content > button")).to_have_count(1)
            expect(page.locator("#stores-count")).to_have_text("(0)")
            page.locator("#stores-toggle").focus()
            page.keyboard.press("Enter")
            expect(page.locator("#stores-toggle")).to_have_attribute("aria-expanded", "false")
            expect(page.locator("#stores-count")).to_be_visible()
            expect(page.get_by_role("button", name="Add store", exact=True)).to_be_hidden()
            page.keyboard.press("Space")
            expect(page.locator("#stores-toggle")).to_have_attribute("aria-expanded", "true")
            page.get_by_role("button", name="Add store", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible()
            page.get_by_role("button", name="Cancel", exact=True).click()
            expect(page.get_by_role("dialog")).not_to_be_visible()
            expect(page.locator("#store-list .store")).to_have_count(0)
            page.get_by_role("button", name="Add store", exact=True).click()
            page.get_by_role("button", name="Open folder nested", exact=True).click()
            expect(page.locator("#picker-message")).to_have_text("This directory is empty.")
            page.get_by_role("button", name="Up", exact=True).click()
            page.screenshot(path="/tmp/nmnm-ui-picker-desktop.png", full_page=True)
            page.get_by_role("button", name="Select database invalid.db", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible()
            expect(page.locator("#picker-message")).not_to_contain_text("Choose a folder")
            page.get_by_role("button", name="Select database memory.db", exact=True).click()
            expect(page.get_by_role("dialog")).not_to_be_visible()
            page.locator(".row").first.wait_for()
            expect(page.locator("#stores-count")).to_have_text("(1)")
            page.locator("#stores-toggle").click()
            expect(page.locator("#stores-count")).to_be_visible()
            expect(page.locator("#store-list")).to_be_hidden()
            expect(page.locator(".row")).to_have_count(8)
            page.locator("#stores-toggle").click()
            expect(page.locator("#store-list input[type=checkbox]")).to_be_checked()
            expect(page.locator(".row")).to_have_count(8)
            assert page.locator("#rows").evaluate("el => el.scrollHeight > el.clientHeight")
            assert page.locator("#rows").evaluate("el => Math.abs(el.clientHeight - el.querySelector('.row').offsetHeight * 5) <= 1")
            page.locator("#rows").evaluate("el => el.scrollTop = el.scrollHeight")
            assert page.locator("#rows").evaluate("el => el.scrollTop > 0")
            page.locator("#source").select_option("recorded:unknown")
            page.get_by_role("button", name="Apply filters").click()
            expect(page.locator(".row")).to_have_count(1)
            expect(page.locator(".row")).to_contain_text("Recorded unknown")
            page.locator("#source").select_option("recorded:pi")
            page.get_by_role("button", name="Apply filters").click()
            pending = []
            page.route("**/api/memory?*", lambda route: pending.append(route))
            page.locator(".row").click()
            expect(page.locator("main")).to_have_attribute("aria-busy", "true")
            assert page.evaluate("() => document.querySelector('main').inert")
            page.evaluate("() => document.querySelector('.row').click()")
            assert len(pending) == 1
            pending[0].continue_()
            page.unroute("**/api/memory?*")
            expect(page.locator("#edit-content")).to_be_disabled()
            assert page.evaluate("() => window.injected") is None
            page.get_by_role("button", name="Enable editing", exact=True).click()
            expect(page.locator("#edit-content")).to_be_enabled()
            page.locator("#edit-content").fill("Unsaved draft")
            page.once("dialog", lambda dialog: dialog.dismiss())
            page.get_by_role("button", name="Remove store from list:", exact=False).click()
            expect(page.locator("#store-list .store")).to_have_count(1)
            expect(page.locator("#edit-content")).to_have_value("Unsaved draft")
            page.once("dialog", lambda dialog: dialog.dismiss())
            page.get_by_role("button", name="Refresh", exact=True).click()
            expect(page.locator("#edit-content")).to_have_value("Unsaved draft")
            page.locator("#edit-content").fill("Reviewed preference")
            page.get_by_role("button", name="Save changes", exact=True).click()
            page.get_by_text("Changes saved.", exact=True).wait_for()
            page.get_by_role("button", name="Switch to light theme").click()
            expect(page.locator("html")).to_have_attribute("data-theme", "light")
            page.screenshot(path="/tmp/nmnm-ui-desktop-light.png", full_page=True)
            page.get_by_role("button", name="Switch to dark theme").click()
            page.screenshot(path="/tmp/nmnm-ui-desktop-dark.png", full_page=True)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            assert page.locator("header").bounding_box()["y"] == 0
            footer = page.locator("footer").bounding_box()
            assert abs(footer["y"] + footer["height"] - 1000) < 1
            page.evaluate("() => window.scrollTo(0, 0)")
            page.on("dialog", lambda dialog: dialog.accept())
            page.get_by_role("button", name="Remove", exact=True).click()
            page.get_by_text("Memory removed.", exact=True).wait_for()
            expect(page.locator("#detail")).to_have_text("Select a memory to inspect its content and origin.")
            expect(page.locator("#edit-content")).to_have_count(0)
            page.locator("#state").select_option("removed")
            page.get_by_role("button", name="Apply filters").click()
            page.get_by_role("button", name="Reviewed preference", exact=False).click()
            page.get_by_role("button", name="Restore", exact=True).click()
            page.get_by_text("Memory restored.", exact=True).wait_for()
            page.locator("#state").select_option("active")
            page.get_by_role("button", name="Apply filters").click()
            page.set_viewport_size({"width": 390, "height": 844})
            page.get_by_role("button", name="Add store", exact=True).click()
            expect(page.get_by_role("dialog")).to_be_visible()
            expect(page.get_by_role("button", name="Select database memory.db", exact=True)).to_be_visible()
            assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path="/tmp/nmnm-ui-picker-mobile.png", full_page=True)
            page.keyboard.press("Escape")
            expect(page.get_by_role("dialog")).not_to_be_visible()
            page.locator(".row").click()
            expect(page.get_by_role("button", name="Back to memories")).to_be_visible()
            assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth")
            page.screenshot(path="/tmp/nmnm-ui-mobile-dark.png", full_page=True)
            page.get_by_role("button", name="Switch to light theme").click()
            page.screenshot(path="/tmp/nmnm-ui-mobile-light.png", full_page=True)
            page.evaluate("() => window.scrollTo(0, document.body.scrollHeight)")
            assert page.locator("header").bounding_box()["y"] == 0
            footer = page.locator("footer").bounding_box()
            assert abs(footer["y"] + footer["height"] - 844) < 1
            page.get_by_role("button", name="Back to memories").click()
            expect(page.locator(".row")).to_be_visible()
            page.locator(".row").click()
            page.get_by_role("button", name="Purge permanently").click()
            page.get_by_text("Memory purged.", exact=True).wait_for()
            expect(page.locator("#detail")).to_have_text("Select a memory to inspect its content and origin.")
            expect(page.locator("#edit-content")).to_have_count(0)
            page.locator("#source").select_option("")
            page.locator("#state").select_option("expired")
            page.get_by_role("button", name="Apply filters").click()
            page.locator(".row").click()
            expect(page.get_by_role("button", name="Remove", exact=True)).to_be_disabled()
            page.locator("#edit-expires_at").fill("")
            page.get_by_role("button", name="Save changes", exact=True).click()
            page.get_by_text("Changes saved.", exact=True).wait_for()
            assert not errors, errors
            page.get_by_role("button", name="Remove store from list:", exact=False).click()
            expect(page.locator("#store-list .store")).to_have_count(0)
            expect(page.locator("#detail")).to_have_text("Select a memory to inspect its content and origin.")
            expect(page.locator("#stores-count")).to_have_text("(0)")
            expect(page.locator("#count")).to_have_text("Select a store to begin.")
            expect(page.get_by_role("button", name="Add store", exact=True)).to_be_focused()
            assert Path(fixture["path"]).exists()
            page.get_by_role("button", name="Add store", exact=True).click()
            page.get_by_role("button", name="Select database memory.db", exact=True).click()
            expect(page.locator("#store-list .store")).to_have_count(1)
            expect(page.get_by_role("button", name="Enable editing", exact=True)).to_be_visible()
            expect(page.locator("#stores-count")).to_have_text("(1)")
            page.locator("#stores-toggle").click()
            expect(page.locator("#stores-count")).to_be_visible()
            expect(page.locator("#stores-toggle")).to_have_attribute("aria-expanded", "false")
            page.locator("#stores-toggle").click()
            page.locator("#state").select_option("active")
            page.get_by_role("button", name="Apply filters").click()
            expect(page.get_by_role("button", name="Expired decision", exact=False)).to_be_visible()
            browser.close()
            print("Browser checks passed: directory picker/cancellation, fixed chrome, theme icons, sources, literal rendering, read-only, drafts, cleanup, expiry, and mobile navigation.")
    finally:
        server.terminate()
        server.wait(timeout=15)
