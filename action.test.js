const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { runAction, ActionError } = require("./action.js");

// Stubs the filesystem and environment that runAction reads. Nothing here
// touches the real filesystem (fs is mocked) and the env values are
// test-controlled and cleared after every test.
function stubEvent(opts = {}) {
    // Use `in` checks (not default params) so callers can pass `undefined`
    // explicitly to assert the "env var not set" branches.
    const event = "event" in opts ? opts.event : { pull_request: { labels: [{ name: "bugfix" }] } };
    const exists = "exists" in opts ? opts.exists : true;
    const eventPath = "eventPath" in opts ? opts.eventPath : "/mock/event.json";
    const inputLabels = "inputLabels" in opts ? opts.inputLabels : "bugfix";

    mock.method(fs, "existsSync", () => exists);
    mock.method(fs, "readFileSync", () => JSON.stringify(event));

    if (eventPath === undefined) {
        delete process.env.GITHUB_EVENT_PATH;
    } else {
        process.env.GITHUB_EVENT_PATH = eventPath;
    }

    if (inputLabels === undefined) {
        delete process.env.INPUT_LABELS;
    } else {
        process.env.INPUT_LABELS = inputLabels;
    }
}

afterEach(() => {
    mock.restoreAll();
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.INPUT_LABELS;
});

test("throws when the event path is not set", () => {
    stubEvent({ eventPath: undefined });
    assert.throws(() => runAction(), /GITHUB_EVENT_PATH .* does not exist/);
});

test("throws when the event file does not exist", () => {
    stubEvent({ exists: false });
    assert.throws(() => runAction(), /GITHUB_EVENT_PATH .* does not exist/);
});

test("throws when the event is not a pull request", () => {
    stubEvent({ event: { push: {} } });
    assert.throws(() => runAction(), /This is not a pull request\./);
});

test("throws when the pull request has no labels property", () => {
    stubEvent({ event: { pull_request: {} } });
    assert.throws(() => runAction(), /No labels defined on the pull request\./);
});

test("throws when the pull request has an empty labels array", () => {
    stubEvent({ event: { pull_request: { labels: [] } } });
    assert.throws(() => runAction(), /No labels defined on the pull request\./);
});

test("throws when no required labels are defined for the action", () => {
    stubEvent({ inputLabels: undefined });
    assert.throws(() => runAction(), /No required labels defined for the action\./);
});

test("throws when the required labels input contains only whitespace and commas", () => {
    stubEvent({ inputLabels: " , , " });
    assert.throws(() => runAction(), /No required labels defined for the action\./);
});

test("ignores empty entries in the required labels input", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "new-feature" }] } },
        inputLabels: "bugfix,,new-feature,",
    });
    assert.doesNotThrow(() => runAction());
});

test("throws when none of the PR labels match the required labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.throws(() => runAction(), /No matching required labels found\./);
});

test("failures raised by the action are ActionError instances", () => {
    stubEvent({ event: { push: {} } });
    assert.throws(() => runAction(), ActionError);
});

test("throws a non-ActionError when the event file is not valid JSON", () => {
    stubEvent();
    mock.method(fs, "readFileSync", () => "{ not json");
    assert.throws(() => runAction(), (err) => err instanceof SyntaxError && !(err instanceof ActionError));
});

test("succeeds when at least one PR label matches a required label", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.doesNotThrow(() => runAction());
});

test("trims whitespace around required labels before matching", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: " bugfix , breaking-change , new-feature ",
    });
    assert.doesNotThrow(() => runAction());
});
