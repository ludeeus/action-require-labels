const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runAction } = require("./action.js");

let tmpDir;
let savedEventPath;
let savedInputLabels;

beforeEach(() => {
    // Preserve the ambient environment so each test is isolated.
    savedEventPath = process.env.GITHUB_EVENT_PATH;
    savedInputLabels = process.env.INPUT_LABELS;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "action-require-labels-"));
});

afterEach(() => {
    if (savedEventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH;
    } else {
        process.env.GITHUB_EVENT_PATH = savedEventPath;
    }

    if (savedInputLabels === undefined) {
        delete process.env.INPUT_LABELS;
    } else {
        process.env.INPUT_LABELS = savedInputLabels;
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Writes the given event object to a temp file and points the action at it.
function setEvent(event) {
    const eventPath = path.join(tmpDir, "event.json");
    fs.writeFileSync(eventPath, JSON.stringify(event), { encoding: "utf8" });
    process.env.GITHUB_EVENT_PATH = eventPath;
    return eventPath;
}

// Builds a pull_request event with the provided label names.
function pullRequestEvent(labelNames) {
    return {
        pull_request: {
            labels: labelNames.map((name) => ({ name })),
        },
    };
}

test("throws when GITHUB_EVENT_PATH is not set", () => {
    delete process.env.GITHUB_EVENT_PATH;
    process.env.INPUT_LABELS = "bugfix";

    assert.throws(() => runAction(), /GITHUB_EVENT_PATH .* does not exist/);
});

test("throws when GITHUB_EVENT_PATH points to a missing file", () => {
    process.env.GITHUB_EVENT_PATH = path.join(tmpDir, "does-not-exist.json");
    process.env.INPUT_LABELS = "bugfix";

    assert.throws(() => runAction(), /GITHUB_EVENT_PATH .* does not exist/);
});

test("throws when the event is not a pull request", () => {
    setEvent({ push: {} });
    process.env.INPUT_LABELS = "bugfix";

    assert.throws(() => runAction(), /This is not a pull request\./);
});

test("throws when the pull request has no labels property", () => {
    setEvent({ pull_request: {} });
    process.env.INPUT_LABELS = "bugfix";

    assert.throws(() => runAction(), /No labels defined on the pull request\./);
});

test("throws when the pull request has an empty labels array", () => {
    setEvent(pullRequestEvent([]));
    process.env.INPUT_LABELS = "bugfix";

    assert.throws(() => runAction(), /No labels defined on the pull request\./);
});

test("throws when no required labels are defined for the action", () => {
    setEvent(pullRequestEvent(["bugfix"]));
    delete process.env.INPUT_LABELS;

    assert.throws(() => runAction(), /No required labels defined for the action\./);
});

test("throws when none of the PR labels match the required labels", () => {
    setEvent(pullRequestEvent(["documentation", "question"]));
    process.env.INPUT_LABELS = "bugfix,breaking-change,new-feature";

    assert.throws(() => runAction(), /No matching required labels found\./);
});

test("succeeds when at least one PR label matches a required label", () => {
    setEvent(pullRequestEvent(["bugfix", "question"]));
    process.env.INPUT_LABELS = "bugfix,breaking-change,new-feature";

    assert.doesNotThrow(() => runAction());
});

test("trims whitespace around required labels before matching", () => {
    setEvent(pullRequestEvent(["bugfix"]));
    process.env.INPUT_LABELS = " bugfix , breaking-change , new-feature ";

    assert.doesNotThrow(() => runAction());
});
