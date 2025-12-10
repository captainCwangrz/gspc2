from playwright.sync_api import sync_playwright
import time
import os
import json

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # Capture console logs
    page.on("console", lambda msg: print(f"CONSOLE: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"PAGE ERROR: {exc}"))

    # Mock API Data
    mock_data = {
        "nodes": [
            { "id": 1, "name": "Jules Winnfield", "username": "jules_test", "avatar": "../assets/1.png", "signature": "Test sig", "val": 1 },
            { "id": 2, "name": "Vincent Vega", "username": "vincent_v", "avatar": "../assets/2.png", "signature": "Royale with cheese", "val": 1 },
            { "id": 3, "name": "Mia Wallace", "username": "mia_w", "avatar": "../assets/3.png", "signature": "Fox Force Five", "val": 1 }
        ],
        "links": [
            { "source": 1, "target": 2, "type": "BEST_FRIEND" },
            { "source": 2, "target": 3, "type": "DATING" }
        ],
        "requests": [],
        "current_user_id": 1
    }

    # Catch-all to mock other php calls to avoid errors - Register FIRST so specific routes override it
    page.route("**/*.php*", lambda route: route.fulfill(status=200, body=json.dumps({"success":True})))

    # Route API calls
    page.route("**/api/data.php", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(mock_data)
    ))

    page.route("**/api/messages.php?action=sync_read_receipts", lambda route: route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps({"success": True, "receipts": []})
    ))

    # Start local python server in background (assumed running by agent separately, or we access via localhost if running)

    page.goto("http://localhost:8000/verification/test_dashboard.html")

    # Wait for graph to initialize and canvas to appear
    try:
        page.wait_for_selector('div[id="3d-graph"] canvas', timeout=10000)
    except Exception as e:
        print(f"Wait failed: {e}")

    # Give it a moment for particles to spawn and layout to stabilize
    time.sleep(3)

    # Take screenshot of the graph
    page.screenshot(path="/home/jules/verification/graph_verification.png")

    print("Screenshot saved to /home/jules/verification/graph_verification.png")

    browser.close()

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
