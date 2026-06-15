const { test, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { runAction, setOutput } = require("./action.js");

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
    delete process.env.GITHUB_OUTPUT;
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

test("writes the matching label count to the GITHUB_OUTPUT file on success", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    process.env.GITHUB_OUTPUT = "/mock/output.txt";

    const writes = [];
    mock.method(fs, "appendFileSync", (_path, data) => writes.push(data));

    assert.doesNotThrow(() => runAction());
    assert.match(writes.join(""), /^matching_label_count=2\n$/);
});

test("writes a zero matching label count to GITHUB_OUTPUT before failing on no match", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    process.env.GITHUB_OUTPUT = "/mock/output.txt";

    const writes = [];
    mock.method(fs, "appendFileSync", (_path, data) => writes.push(data));

    assert.throws(() => runAction(), /No matching required labels found\./);
    assert.match(writes.join(""), /^matching_label_count=0\n$/);
});

for (const { label, value } of [
    { label: "a newline", value: "line1\nline2" },
    { label: "a carriage return", value: "line1\rline2" },
    { label: "a carriage return and newline", value: "line1\r\nline2" },
]) {
    test(`setOutput throws when the value contains ${label}`, () => {
        process.env.GITHUB_OUTPUT = "/mock/output.txt";

        const appendMock = mock.method(fs, "appendFileSync", () => {});

        assert.throws(() => setOutput("example", value), /must not contain a newline or carriage return/);
        assert.equal(appendMock.mock.callCount(), 0);
    });
}

for (const { label, name } of [
    { label: "an equals sign", name: "bad=name" },
    { label: "a newline", name: "bad\nname" },
    { label: "a carriage return", name: "bad\rname" },
]) {
    test(`setOutput throws when the name contains ${label}`, () => {
        process.env.GITHUB_OUTPUT = "/mock/output.txt";

        const appendMock = mock.method(fs, "appendFileSync", () => {});

        assert.throws(() => setOutput(name, "1"), /Output name .* must not contain "=", a newline or a carriage return/s);
        assert.equal(appendMock.mock.callCount(), 0);
    });
}

test("setOutput throws when the name is empty", () => {
    process.env.GITHUB_OUTPUT = "/mock/output.txt";

    const appendMock = mock.method(fs, "appendFileSync", () => {});

    assert.throws(() => setOutput("", "1"), /must not be empty/);
    assert.equal(appendMock.mock.callCount(), 0);
});

test("does not write outputs when the action fails before evaluating labels", () => {
    stubEvent({ event: { push: {} } });
    process.env.GITHUB_OUTPUT = "/mock/output.txt";

    const appendMock = mock.method(fs, "appendFileSync", () => {});

    assert.throws(() => runAction(), /This is not a pull request\./);
    assert.equal(appendMock.mock.callCount(), 0);
});

test("does not write outputs when GITHUB_OUTPUT is not set", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix",
    });

    const appendMock = mock.method(fs, "appendFileSync", () => {});

    assert.doesNotThrow(() => runAction());
    assert.equal(appendMock.mock.callCount(), 0);
});
