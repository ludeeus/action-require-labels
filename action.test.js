const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { runAction } = require("./action.js");

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
    const maximumMatchingLabels = "maximumMatchingLabels" in opts ? opts.maximumMatchingLabels : undefined;

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

    if (maximumMatchingLabels === undefined) {
        delete process.env.INPUT_MAXIMUM_MATCHING_LABELS;
    } else {
        process.env.INPUT_MAXIMUM_MATCHING_LABELS = maximumMatchingLabels;
    }
}

afterEach(() => {
    mock.restoreAll();
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.INPUT_LABELS;
    delete process.env.INPUT_MAXIMUM_MATCHING_LABELS;
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
    stubEvent({ event: { pull_request: {} }, inputLabels: "bugfix,new-feature" });
    assert.throws(() => runAction(), /No labels defined on the pull request\. Required labels: bugfix, new-feature\./);
});

test("throws when the pull request has an empty labels array", () => {
    stubEvent({ event: { pull_request: { labels: [] } }, inputLabels: "bugfix,new-feature" });
    assert.throws(() => runAction(), /No labels defined on the pull request\. Required labels: bugfix, new-feature\./);
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

test("warns when the same label is supplied multiple times in the input", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,bugfix,new-feature,bugfix,new-feature",
    });
    const logged = [];
    mock.method(console, "log", (msg) => logged.push(msg));

    assert.doesNotThrow(() => runAction());

    const warnings = logged.filter(line => typeof line === "string" && line.startsWith("::warning::"));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /contains duplicate labels/);
});

test("does not warn when every supplied label is unique", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    const logged = [];
    mock.method(console, "log", (msg) => logged.push(msg));

    assert.doesNotThrow(() => runAction());

    const warnings = logged.filter(line => typeof line === "string" && line.startsWith("::warning::"));
    assert.equal(warnings.length, 0);
});

test("escapes workflow-command characters in label names before logging", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "50%-done" }] } },
        inputLabels: "50%-done",
    });
    const logged = [];
    mock.method(console, "log", (msg) => logged.push(msg));

    assert.doesNotThrow(() => runAction());

    const labelLines = logged.filter(line => typeof line === "string" && line.includes("50%25-done"));
    assert.equal(labelLines.length, 3);
    assert.ok(!logged.some(line => typeof line === "string" && line.includes("50%-done")));
});

test("throws when none of the PR labels match the required labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.throws(() => runAction(), /No matching required labels found\. Required labels: bugfix, breaking-change, new-feature\./);
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

test("passes by default when every supplied label matches (cap defaults to supplied count)", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "breaking-change" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.doesNotThrow(() => runAction());
});

test("throws when matching labels exceed maximum_matching_labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
    });
    assert.throws(() => runAction(), /Found 2 matching label\(s\), but a maximum of 1 is allowed\./);
});

test("passes when matching labels equal maximum_matching_labels (boundary, not exceeded)", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "2",
    });
    assert.doesNotThrow(() => runAction());
});

test("passes with maximum_matching_labels of 1 when exactly one label matches", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
    });
    assert.doesNotThrow(() => runAction());
});

for (const value of ["abc", "0", "-1", "1.5"]) {
    test(`throws when maximum_matching_labels is "${value}"`, () => {
        stubEvent({
            event: { pull_request: { labels: [{ name: "bugfix" }] } },
            inputLabels: "bugfix,breaking-change,new-feature",
            maximumMatchingLabels: value,
        });
        assert.throws(() => runAction(), /maximum_matching_labels must be a positive integer\./);
    });
}

for (const { label, value } of [
    { label: "empty", value: "" },
    { label: "a single space", value: " " },
    { label: "only whitespace", value: "            " },
]) {
    test(`treats ${label} maximum_matching_labels as unset and uses the default`, () => {
        stubEvent({
            event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
            inputLabels: "bugfix,breaking-change,new-feature",
            maximumMatchingLabels: value,
        });
        assert.doesNotThrow(() => runAction());
    });
}

test("still throws the no-match error when no labels match, regardless of maximum_matching_labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
    });
    assert.throws(() => runAction(), /No matching required labels found\. Required labels: bugfix, breaking-change, new-feature\./);
});
