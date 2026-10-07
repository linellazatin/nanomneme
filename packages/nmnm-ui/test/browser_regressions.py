"""Rendered correctness regressions; disposable stores, Python Playwright required."""
import json
import os
import math
from pathlib import Path
import subprocess
import tempfile
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[3]
AXE = (ROOT / 'node_modules/axe-core/axe.min.js').read_text()
ENGINE = os.environ.get('NMNM_UI_BROWSER', 'chromium')
FIXTURE = """
import { startServer } from './packages/nmnm-ui/src/server.js';
import { open } from './packages/nmnm-core/src/index.js';
import { join } from 'node:path';
const path = join(process.env.NMNM_UI_TEST_DIR, 'memory.db');
const db = open(path);
for (let index = 0; index < 51; index++) db.retain({content:'Review record ' + index,metadata:{source:'pi'}});
const removed = db.retain({content:'Removed review fixture'}); db.remove({id:removed.id});
db.close();
const app = await startServer({cwd:process.env.NMNM_UI_TEST_DIR,home:process.env.NMNM_UI_TEST_DIR});
console.log(JSON.stringify({url:app.url}));
process.on('SIGTERM',async()=>{await app.close()});
"""


class BrowserRegressions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = getattr(cls.playwright, ENGINE).launch(headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        directory = tempfile.TemporaryDirectory(prefix='nmnm-ui-regression-')
        self.addCleanup(directory.cleanup)
        self.server = subprocess.Popen(['node', '--input-type=module', '-e', FIXTURE], cwd=ROOT,
            env={**os.environ, 'NMNM_UI_TEST_DIR': directory.name, 'HOME': directory.name},
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.addCleanup(self.stop_server)
        line = self.server.stdout.readline()
        if not line:
            self.fail(self.server.stderr.read())
        self.url = json.loads(line)['url']
        self.page = self.browser.new_page(viewport={'width': 1440, 'height': 1000})
        self.addCleanup(self.page.close)
        self.client_errors = []
        self.page.on('pageerror', lambda error: self.client_errors.append(str(error)))
        self.page.goto(self.url)
        self.page.wait_for_load_state('networkidle')
        self.ready()

    def tearDown(self):
        if hasattr(self, 'page'):
            self.assertEqual(self.client_errors, [])

    def stop_server(self):
        self.server.terminate()
        self.server.wait(timeout=15)
        self.server.stdout.close()
        self.server.stderr.close()

    def ready(self):
        expect(self.page.locator('main')).to_have_attribute('aria-busy', 'false')

    def add_store(self):
        self.page.locator('#add-store').click()
        self.page.get_by_role('button', name='Select database memory.db', exact=True).click()
        self.ready()
        expect(self.page.locator('.row')).to_have_count(50)

    def editing(self):
        self.page.get_by_role('button', name='Enable editing', exact=True).click()
        self.ready()

    def test_skip_link_reload_preserves_authorization(self):
        self.page.locator('.skip').focus()
        self.page.keyboard.press('Enter')
        self.page.reload()
        self.page.wait_for_load_state('networkidle')
        self.ready()
        self.assertNotIn('Launch token required', self.page.locator('#message').inner_text())
        self.add_store()

    def shrink_last_page(self, action):
        self.add_store()
        self.editing()
        self.page.locator('#next').click()
        self.ready()
        self.page.locator('.row').click()
        self.ready()
        if action == 'expire':
            self.page.locator('#edit-expires_at').fill('2000-01-01T00:00:00.000Z')
            self.page.get_by_role('button', name='Save changes', exact=True).click()
        else:
            self.page.once('dialog', lambda dialog: dialog.accept())
            self.page.get_by_role('button', name=action, exact=True).click()
        self.ready()
        expect(self.page.locator('#page-label')).to_have_text('Page 1 of 1')
        expect(self.page.locator('.row')).to_have_count(50)

    def test_last_page_removal_returns_to_valid_page(self):
        self.shrink_last_page('Remove')

    def test_last_page_purge_returns_to_valid_page(self):
        self.shrink_last_page('Purge permanently')

    def test_last_page_expiry_edit_returns_to_valid_page(self):
        self.shrink_last_page('expire')

    def test_keyboard_refresh_preserves_focus(self):
        self.add_store()
        refresh = self.page.locator('#refresh')
        refresh.focus()
        self.page.keyboard.press('Enter')
        self.ready()
        expect(refresh).to_be_focused()

    def test_desktop_inspection_preserves_row_focus(self):
        self.add_store()
        row = self.page.locator('.row').first
        row.focus()
        self.page.keyboard.press('Enter')
        self.ready()
        expect(row).to_be_focused()

    def test_mobile_details_and_back_have_logical_focus(self):
        self.add_store()
        self.page.set_viewport_size({'width': 320, 'height': 568})
        row = self.page.locator('.row').first
        row.focus()
        self.page.keyboard.press('Enter')
        self.ready()
        expect(self.page.get_by_role('heading', name='Memory details')).to_be_focused()
        back = self.page.get_by_role('button', name='Back to memories')
        back.focus()
        self.page.keyboard.press('Enter')
        expect(row).to_be_focused()
        expect(row).to_have_attribute('aria-pressed', 'false')

    def test_editing_toggle_preserves_focus_after_rerender(self):
        self.add_store()
        button = self.page.get_by_role('button', name='Enable editing', exact=True)
        button.focus()
        self.page.keyboard.press('Enter')
        self.ready()
        expect(self.page.get_by_role('button', name='Disable editing', exact=True)).to_be_focused()

    def test_save_and_validation_failure_preserve_focus(self):
        self.add_store()
        self.editing()
        self.page.locator('.row').first.click()
        self.ready()
        content = self.page.locator('#edit-content')
        content.fill('Changed content')
        save = self.page.get_by_role('button', name='Save changes', exact=True)
        save.focus()
        self.page.keyboard.press('Enter')
        self.ready()
        expect(save).to_be_focused()
        expect(content).to_have_value('Changed content')
        self.page.locator('#edit-namespace').fill('INVALID NAMESPACE')
        save.focus()
        self.page.keyboard.press('Enter')
        self.ready()
        expect(save).to_be_focused()
        expect(self.page.locator('#edit-namespace')).to_have_value('INVALID NAMESPACE')
        expect(self.page.locator('#message')).to_have_class('error')

    def test_page_has_top_level_heading(self):
        expect(self.page.get_by_role('heading', level=1)).to_have_count(1)

    def test_picker_has_named_semantic_group(self):
        self.page.locator('#add-store').click()
        self.ready()
        expect(self.page.get_by_role('group', name='Directory entries')).to_be_visible()

    def test_enabled_input_boundaries_contrast_in_both_themes(self):
        self.add_store()
        self.editing()
        self.page.locator('.row').first.click()
        self.ready()
        for theme in ['dark', 'light']:
            with self.subTest(theme=theme):
                if theme == 'light':
                    self.page.locator('#theme').click()
                ratios = self.page.evaluate("""() => {
                    const luminance = color => {
                        const channels = color.match(/[\\d.]+/g).slice(0,3).map(v => Number(v)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4);
                        return channels[0]*.2126 + channels[1]*.7152 + channels[2]*.0722;
                    };
                    const outside = luminance(getComputedStyle(document.body).backgroundColor);
                    return ['query','edit-namespace','edit-content'].map(id => {
                        const css = getComputedStyle(document.getElementById(id));
                        const border = luminance(css.borderTopColor);
                        const inside = luminance(css.backgroundColor);
                        return [border,inside].map(v => (Math.max(v,outside)+.05)/(Math.min(v,outside)+.05));
                    });
                }""")
                for border, background in ratios:
                    self.assertGreaterEqual(max(border, background), 3)

    def audit(self, name):
        self.page.evaluate(AXE)
        result = self.page.evaluate("""async () => {
            const result = await axe.run(document, {runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']}});
            return {violations:result.violations, incomplete:result.incomplete};
        }""")
        path = Path(tempfile.gettempdir()) / f'nmnm-ui-{ENGINE}-axe-{name}.json'
        path.write_text(json.dumps(result, indent=2))
        self.assertEqual(result['violations'], [], f'Accessibility violations: {path}')

    def test_accessibility_in_both_themes_and_workbench_states(self):
        for theme in ['dark', 'light']:
            self.page.goto(self.url)
            self.page.wait_for_load_state('networkidle')
            self.ready()
            self.page.locator('#state').select_option('active')
            self.page.locator('#filters button').click()
            self.ready()
            if self.page.locator('html').get_attribute('data-theme') != theme:
                self.page.locator('#theme').click()
            self.audit(theme + '-unselected')
            self.add_store()
            self.audit(theme + '-selected')
            if self.page.get_by_role('button', name='Enable editing', exact=True).count():
                self.editing()
            self.page.locator('.row').first.click()
            self.ready()
            self.audit(theme + '-editing')
            self.page.locator('#state').select_option('removed')
            self.page.locator('#filters button').click()
            self.ready()
            self.page.locator('.row').click()
            self.ready()
            self.audit(theme + '-removed')
            self.page.locator('#add-store').click()
            self.ready()
            self.audit(theme + '-picker')
            self.page.locator('#picker-close').click()

    def test_reflow_text_spacing_and_focus_visibility(self):
        self.add_store()
        self.editing()
        self.page.locator('.row').first.click()
        self.ready()
        self.page.locator('#edit-content').fill('Long content ' * 100)
        self.page.get_by_role('button', name='Save changes', exact=True).click()
        self.ready()
        self.page.evaluate("""() => {
            const sheet = document.styleSheets[0];
            sheet.insertRule('*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important}', sheet.cssRules.length);
            sheet.insertRule('p{margin-bottom:2em!important}', sheet.cssRules.length);
        }""")
        for width in [1440, 320]:
            with self.subTest(width=width):
                self.page.set_viewport_size({'width': width, 'height': 568})
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width)
                for selector in ['#edit-content', '#edit-namespace', '#edit-confidence', '#edit-save']:
                    self.page.locator(selector).focus()
                    visible = self.page.locator(selector).evaluate("""el => {
                        const box = el.getBoundingClientRect(), header = document.querySelector('header').getBoundingClientRect(), footer = document.querySelector('footer').getBoundingClientRect();
                        return box.bottom > header.bottom && box.top < footer.top;
                    }""")
                    self.assertTrue(visible, f'{selector} fully obscured at {width}px: ' + str(self.page.locator(selector).bounding_box()))
                self.page.locator('#add-store').click()
                self.ready()
                self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'), width)
                self.page.screenshot(path=str(Path(tempfile.gettempdir()) / f'nmnm-ui-{ENGINE}-spacing-{width}.png'), full_page=True)
                self.page.locator('#picker-close').click()

    def test_keyboard_focus_indicator_contrasts_in_both_themes(self):
        for theme in ['dark', 'light']:
            if theme == 'light':
                self.page.locator('#theme').click()
            self.page.locator('#refresh').focus()
            self.page.keyboard.press('Tab')
            self.page.keyboard.press('Shift+Tab')
            expect(self.page.locator('#refresh')).to_be_focused()
            colors = self.page.locator('#refresh').evaluate("""el => ({
                color:getComputedStyle(el).outlineColor, background:getComputedStyle(document.body).backgroundColor,
                width:parseFloat(getComputedStyle(el).outlineWidth), visible:el.matches(':focus-visible')
            })""")
            def luminance(color):
                channels = [float(value)/255 for value in color[color.index('(')+1:color.index(')')].split(',')[:3]]
                channels = [value/12.92 if value <= .04045 else math.pow((value+.055)/1.055, 2.4) for value in channels]
                return sum(value*weight for value, weight in zip(channels, [.2126, .7152, .0722]))
            low, high = sorted([luminance(colors['color']), luminance(colors['background'])])
            self.assertTrue(colors['visible'])
            self.assertGreaterEqual(colors['width'], 2)
            self.assertGreaterEqual((high+.05)/(low+.05), 3)

    def test_refresh_and_pagination_ignore_unapplied_filters(self):
        self.add_store()
        self.page.locator('#query').fill('no matching content')
        self.page.locator('#refresh').click()
        self.ready()
        expect(self.page.locator('.row')).to_have_count(50)
        self.page.locator('#next').click()
        self.ready()
        expect(self.page.locator('.row')).to_have_count(1)
        self.page.locator('#filters button').click()
        self.ready()
        expect(self.page.locator('.row')).to_have_count(0)
        expect(self.page.locator('#page-label')).to_have_text('')


if __name__ == '__main__':
    unittest.main()
