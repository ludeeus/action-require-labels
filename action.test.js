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
    const requireInput = "require" in opts ? opts.require : undefined;

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

    if (requireInput === undefined) {
        delete process.env.INPUT_REQUIRE;
    } else {
        process.env.INPUT_REQUIRE = requireInput;
    }
}

afterEach(() => {
    mock.restoreAll();
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.INPUT_LABELS;
    delete process.env.INPUT_REQUIRE;
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
    assert.throws(() => runAction(), /Found 0 matching label\(s\) on the pull request, but at least 1 of the configured label\(s\) is required \(bugfix, new-feature\)\./);
});

test("throws when the pull request has an empty labels array", () => {
    stubEvent({ event: { pull_request: { labels: [] } }, inputLabels: "bugfix,new-feature" });
    assert.throws(() => runAction(), /Found 0 matching label\(s\) on the pull request, but at least 1 of the configured label\(s\) is required \(bugfix, new-feature\)\./);
});

test("throws when no labels are defined for the action", () => {
    stubEvent({ inputLabels: undefined });
    assert.throws(() => runAction(), /No labels defined for the action\./);
});

test("throws when the labels input contains only whitespace and commas", () => {
    stubEvent({ inputLabels: " , , " });
    assert.throws(() => runAction(), /No labels defined for the action\./);
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
        event: { pull_request: { labels: [{ name: "50%-done\r\n::error::injected" }] } },
        inputLabels: "50%-done\r\n::error::injected",
    });
    const logged = [];
    mock.method(console, "log", (msg) => logged.push(msg));

    assert.doesNotThrow(() => runAction());

    const escaped = "50%25-done%0D%0A::error::injected";
    const labelLines = logged.filter(line => typeof line === "string" && line.includes(escaped));
    assert.equal(labelLines.length, 3);
    assert.ok(!logged.some(line => typeof line === "string" && /[\r\n]/.test(line)));
});

test("throws when none of the PR labels match the required labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.throws(() => runAction(), /Found 0 matching label\(s\) on the pull request, but at least 1 of the configured label\(s\) is required \(bugfix, breaking-change, new-feature\)\./);
});

test("failures raised by the action are ActionError instances", () => {
    stubEvent({ event: { push: {} } });
    assert.throws(() => runAction(), ActionError);
});

test("throws a non-ActionError when the event file is not valid JSON", () => {
    // Set up the fs mocks directly (rather than via stubEvent) so readFileSync
    // is mocked exactly once with the malformed payload.
    mock.method(fs, "existsSync", () => true);
    mock.method(fs, "readFileSync", () => "{ not json");
    process.env.GITHUB_EVENT_PATH = "/mock/event.json";
    process.env.INPUT_LABELS = "bugfix";

    assert.throws(() => runAction(), (err) => err instanceof SyntaxError && !(err instanceof ActionError));
});

test("the require limit failure is an ActionError", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "1",
    });
    assert.throws(() => runAction(), ActionError);
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

test("require: none passes when none of the labels are present", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }, { name: "question" }] } },
        inputLabels: "do-not-merge,wip,blocked",
        require: "none",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: none passes when the pull request has no labels at all", () => {
    stubEvent({
        event: { pull_request: { labels: [] } },
        inputLabels: "do-not-merge,wip,blocked",
        require: "none",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: none passes when the pull request has no labels property", () => {
    stubEvent({
        event: { pull_request: {} },
        inputLabels: "do-not-merge,wip,blocked",
        require: "none",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: none fails and names the present labels when a listed label is present", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "do-not-merge" }, { name: "wip" }, { name: "question" }] } },
        inputLabels: "do-not-merge,wip,blocked",
        require: "none",
    });
    assert.throws(() => runAction(), /Found 2 matching label\(s\) on the pull request \(do-not-merge, wip\), but at most 0 is allowed\./);
});

test("require: none escapes workflow-command characters in label names before logging", () => {
    const injected = "block%-me\r\n::error::injected";
    stubEvent({
        event: { pull_request: { labels: [{ name: injected }] } },
        inputLabels: injected,
        require: "none",
    });
    const logged = [];
    mock.method(console, "log", (msg) => logged.push(msg));

    assert.throws(() => runAction());

    assert.ok(logged.some(line => typeof line === "string" && line.includes("block%25-me%0D%0A::error::injected")));
    assert.ok(!logged.some(line => typeof line === "string" && /[\r\n]/.test(line)));
});

test("require: an exact count passes when exactly that many labels match", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "2",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: an exact count fails when fewer labels match", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "2",
    });
    assert.throws(() => runAction(), /Found 1 matching label\(s\) on the pull request, but at least 2 of the configured label\(s\) is required \(bugfix, breaking-change, new-feature\)\./);
});

test("require: an exact count fails when more labels match", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "1",
    });
    assert.throws(() => runAction(), /Found 2 matching label\(s\) on the pull request \(bugfix, new-feature\), but at most 1 is allowed\./);
});

test("require: <=N passes when the number of matching labels is within the cap", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "<=2",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: <=N passes when no labels match at all (lower bound is zero)", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "<=2",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: <=N fails when the number of matching labels exceeds the cap", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "breaking-change" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: "<=2",
    });
    assert.throws(() => runAction(), /Found 3 matching label\(s\) on the pull request \(bugfix, breaking-change, new-feature\), but at most 2 is allowed\./);
});

test("require: >=N passes when enough labels match", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "breaking-change" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: ">=2",
    });
    assert.doesNotThrow(() => runAction());
});

test("require: >=N fails when too few labels match", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        require: ">=2",
    });
    assert.throws(() => runAction(), /Found 1 matching label\(s\) on the pull request, but at least 2 of the configured label\(s\) is required \(bugfix, breaking-change, new-feature\)\./);
});

for (const value of ["all", "1.5", "-1", "<1", "> 2", "==2", "<=", "9".repeat(400), "9007199254740992"]) {
    test(`throws when require is "${value}"`, () => {
        stubEvent({
            event: { pull_request: { labels: [{ name: "bugfix" }] } },
            inputLabels: "bugfix,breaking-change,new-feature",
            require: value,
        });
        assert.throws(() => runAction(), /require must be 'any', 'none', a non-negative integer, or a '<=' \/ '>=' comparison/);
    });
}

for (const { label, value } of [
    { label: "empty", value: "" },
    { label: "whitespace", value: "   " },
    { label: "the keyword any", value: "any" },
    { label: "the keyword any with surrounding whitespace and casing", value: " ANY " },
]) {
    test(`treats ${label} require as the default at-least-one rule`, () => {
        stubEvent({
            event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
            inputLabels: "bugfix,breaking-change,new-feature",
            require: value,
        });
        assert.doesNotThrow(() => runAction());
    });
}

test("resolves the none keyword regardless of casing and surrounding whitespace", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "do-not-merge" }] } },
        inputLabels: "do-not-merge,wip",
        require: " None ",
    });
    assert.throws(() => runAction(), /but at most 0 is allowed/);
});
