const { test, mock, afterEach, snapshot } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const { runAction, main, ActionError } = require("./action.js");

// Store the generated markdown verbatim, so action.test.js.snapshot reads as the
// rendered summaries a run would produce. Regenerate with:
//     node --test --test-update-snapshots
snapshot.setDefaultSnapshotSerializers([(value) => value]);

const originalExitCode = process.exitCode;

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
    const summary = "summary" in opts ? opts.summary : undefined;
    const stepSummaryPath = "stepSummaryPath" in opts ? opts.stepSummaryPath : undefined;
    const actionRef = "actionRef" in opts ? opts.actionRef : undefined;

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

    if (summary === undefined) {
        delete process.env.INPUT_SUMMARY;
    } else {
        process.env.INPUT_SUMMARY = summary;
    }

    if (stepSummaryPath === undefined) {
        delete process.env.GITHUB_STEP_SUMMARY;
    } else {
        process.env.GITHUB_STEP_SUMMARY = stepSummaryPath;
    }

    if (actionRef === undefined) {
        delete process.env.GITHUB_ACTION_REF;
    } else {
        process.env.GITHUB_ACTION_REF = actionRef;
    }
}

// Captures the summary file writes main() performs, so no test touches disk.
function captureSummary() {
    const writes = [];
    mock.method(fs, "appendFileSync", (path, data) => writes.push({ path, data }));
    return writes;
}

function captureLog() {
    const logged = [];
    mock.method(console, "log", (msg) => logged.push(msg));
    return logged;
}

afterEach(() => {
    mock.restoreAll();
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.INPUT_LABELS;
    delete process.env.INPUT_MAXIMUM_MATCHING_LABELS;
    delete process.env.INPUT_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_ACTION_REF;
    // main() sets process.exitCode on failure; restore it so a failing-run test
    // cannot make the test runner itself exit non-zero.
    process.exitCode = originalExitCode;
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

test("reports a failure when the pull request has no labels property", () => {
    stubEvent({ event: { pull_request: {} }, inputLabels: "bugfix,new-feature" });
    assert.equal(runAction().failureMessage, "No labels defined on the pull request. Required labels: bugfix, new-feature.");
});

test("reports a failure when the pull request has an empty labels array", () => {
    stubEvent({ event: { pull_request: { labels: [] } }, inputLabels: "bugfix,new-feature" });
    assert.equal(runAction().failureMessage, "No labels defined on the pull request. Required labels: bugfix, new-feature.");
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
    assert.equal(runAction().failureMessage, null);
});

test("warns when the same label is supplied multiple times in the input", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,bugfix,new-feature,bugfix,new-feature",
    });
    const logged = captureLog();

    assert.equal(runAction().failureMessage, null);

    const warnings = logged.filter(line => typeof line === "string" && line.startsWith("::warning::"));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /contains duplicate labels/);
});

test("does not warn when every supplied label is unique", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    const logged = captureLog();

    assert.equal(runAction().failureMessage, null);

    const warnings = logged.filter(line => typeof line === "string" && line.startsWith("::warning::"));
    assert.equal(warnings.length, 0);
});

test("escapes workflow-command characters in label names before logging", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "50%-done\r\n::error::injected" }] } },
        inputLabels: "50%-done\r\n::error::injected",
    });
    const logged = captureLog();

    assert.equal(runAction().failureMessage, null);

    const escaped = "50%25-done%0D%0A::error::injected";
    const labelLines = logged.filter(line => typeof line === "string" && line.includes(escaped));
    assert.equal(labelLines.length, 3);
    assert.ok(!logged.some(line => typeof line === "string" && /[\r\n]/.test(line)));
});

test("reports a failure when none of the PR labels match the required labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.equal(runAction().failureMessage, "No matching required labels found. Required labels: bugfix, breaking-change, new-feature.");
});

test("invalid configuration is raised as an ActionError", () => {
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

test("succeeds when at least one PR label matches a required label", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.equal(runAction().failureMessage, null);
});

test("trims whitespace around required labels before matching", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: " bugfix , breaking-change , new-feature ",
    });
    assert.equal(runAction().failureMessage, null);
});

test("passes by default when every supplied label matches (cap defaults to supplied count)", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "breaking-change" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    });
    assert.equal(runAction().failureMessage, null);
});

test("reports a failure when matching labels exceed maximum_matching_labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
    });
    assert.equal(runAction().failureMessage, "Found 2 matching label(s), but a maximum of 1 is allowed.");
});

test("passes when matching labels equal maximum_matching_labels (boundary, not exceeded)", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "2",
    });
    assert.equal(runAction().failureMessage, null);
});

test("passes with maximum_matching_labels of 1 when exactly one label matches", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
    });
    assert.equal(runAction().failureMessage, null);
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
    { label: "a digit string that overflows to Infinity", value: "9".repeat(400) },
    { label: "a value above Number.MAX_SAFE_INTEGER", value: "9007199254740992" },
]) {
    test(`throws when maximum_matching_labels is ${label}`, () => {
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
        assert.equal(runAction().failureMessage, null);
    });
}

test("still reports the no-match failure when no labels match, regardless of maximum_matching_labels", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
    });
    assert.equal(runAction().failureMessage, "No matching required labels found. Required labels: bugfix, breaking-change, new-feature.");
});

test("throws when the summary mode is not recognized", () => {
    stubEvent({ summary: "verbose" });
    assert.throws(() => runAction(), /summary must be one of: never, always, error, minimal, minimal_error\./);
});

test("the unrecognized summary mode failure is an ActionError", () => {
    stubEvent({ summary: "verbose" });
    assert.throws(() => runAction(), ActionError);
});

test("main() exits zero and logs no error on a passing run", () => {
    stubEvent({ event: { pull_request: { labels: [{ name: "bugfix" }] } }, inputLabels: "bugfix" });
    const logged = captureLog();

    main();

    assert.equal(process.exitCode, originalExitCode);
    assert.ok(!logged.some(line => typeof line === "string" && line.startsWith("::error::")));
});

test("main() logs the escaped failure and exits non-zero on a failing run", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change",
    });
    const logged = captureLog();

    main();

    assert.equal(process.exitCode, 1);
    assert.ok(logged.includes("::error::No matching required labels found. Required labels: bugfix, breaking-change."));
});

test("main() escapes label-derived characters in the failure annotation", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "question" }] } },
        inputLabels: "50%-done\r\n::error::injected",
    });
    const logged = captureLog();

    main();

    assert.equal(process.exitCode, 1);
    const errors = logged.filter(line => typeof line === "string" && line.startsWith("::error::"));
    assert.equal(errors.length, 1);
    assert.match(errors[0], /50%25-done%0D%0A::error::injected/);
    assert.ok(!/[\r\n]/.test(errors[0]));
});

test("main() reports an invalid configuration as an escaped ActionError annotation", () => {
    stubEvent({ event: { push: {} } });
    const logged = captureLog();

    main();

    assert.equal(process.exitCode, 1);
    assert.ok(logged.includes("::error::This is not a pull request."));
});

test("main() withholds the message for an unexpected error", () => {
    mock.method(fs, "existsSync", () => true);
    mock.method(fs, "readFileSync", () => "{ not json");
    process.env.GITHUB_EVENT_PATH = "/mock/event.json";
    process.env.INPUT_LABELS = "bugfix";
    const logged = captureLog();

    main();

    assert.equal(process.exitCode, 1);
    assert.ok(logged.includes("::error::Unknown error"));
    assert.ok(!logged.some(line => typeof line === "string" && line.includes("not json")));
});

test("does not write a summary when the input is unset (defaults to never)", () => {
    stubEvent({ stepSummaryPath: "/mock/summary.md" });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 0);
});

test("does not write a summary on a failing run when the input is unset (defaults to never)", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
});

test("does not write a summary when the mode is \"never\"", () => {
    stubEvent({ summary: "never", stepSummaryPath: "/mock/summary.md" });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 0);
});

test("does not write a summary when \"always\" but GITHUB_STEP_SUMMARY is unset", () => {
    stubEvent({ summary: "always" });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 0);
});

test("\"always\" writes a passing summary with the three label groups", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "/mock/summary.md");
    t.assert.snapshot(writes[0].data);
});

test("shows the cap in the passing summary only when it constrains", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "p1" }] } },
        inputLabels: "p1,p2,p3",
        maximumMatchingLabels: "1",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    t.assert.snapshot(writes[0].data);
});

test("omits the cap from the passing summary when it uses the default", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.doesNotMatch(writes[0].data, /\(max \d+ allowed\)/);
    t.assert.snapshot(writes[0].data);
});

test("\"always\" writes a failing summary and still exits non-zero", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 1);
    t.assert.snapshot(writes[0].data);
});

test("\"always\" writes an empty Present group when the pull request has no labels", (t) => {
    stubEvent({
        event: { pull_request: { labels: [] } },
        inputLabels: "bugfix,breaking-change",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(process.exitCode, 1);
    t.assert.snapshot(writes[0].data);
});

test("\"always\" writes the summary for the maximum_matching_labels failure", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "new-feature" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        maximumMatchingLabels: "1",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(process.exitCode, 1);
    t.assert.snapshot(writes[0].data);
});

test("does not write a summary when an invalid configuration prevents the check", () => {
    stubEvent({ event: { push: {} }, summary: "always", stepSummaryPath: "/mock/summary.md" });
    const writes = captureSummary();

    main();

    assert.equal(process.exitCode, 1);
    assert.equal(writes.length, 0);
});

test("\"error\" does not write a summary on a passing run", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "error",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 0);
});

test("\"error\" writes the full table on a failing run", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "error",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 1);
    t.assert.snapshot(writes[0].data);
});

test("\"minimal\" writes only the status line on a passing run", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
        summary: "minimal",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0].data, /\| Group \| Labels \|/);
    t.assert.snapshot(writes[0].data);
});

test("\"minimal\" writes the status line on a failing run", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "minimal",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0].data, /\| Group \| Labels \|/);
    t.assert.snapshot(writes[0].data);
});

test("\"minimal_error\" does not write a summary on a passing run", () => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "minimal_error",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 0);
});

test("\"minimal_error\" writes only the status line on a failing run", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "documentation" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "minimal_error",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.equal(writes.length, 1);
    assert.doesNotMatch(writes[0].data, /\| Group \| Labels \|/);
    t.assert.snapshot(writes[0].data);
});

test("escapes markdown-breaking characters in label names within the summary", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "a|b`c\r\nd" }] } },
        inputLabels: "a|b`c\r\nd",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    const written = writes[0].data;
    // Invariants the snapshot must never be regenerated away from: no raw pipe
    // can reach a cell, and no row may break across lines.
    assert.ok(!written.includes("a|b"));
    for (const line of written.split("\n")) {
        assert.ok(!/[\r\n]/.test(line));
    }
    t.assert.snapshot(written);
});

test("escapes markdown metacharacters in the failing status line", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "question" }] } },
        inputLabels: "*bold*,_em_,[link](http://example.com),<b>html</b>,a&b,~strike~",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    const statusLine = writes[0].data.split("\n").find(line => line.startsWith("❌"));
    // Every inline construct the label names could open must arrive escaped, so
    // the status line renders the label text literally.
    for (const metacharacter of ["*", "_", "[", "]", "<", ">", "&", "~"]) {
        assert.ok(!statusLine.includes(metacharacter) || statusLine.includes(`\\${metacharacter}`));
    }
    assert.doesNotMatch(statusLine, /\[link\]\(/);
    t.assert.snapshot(writes[0].data);
});

test("pads the code span when a label starts or ends with a backtick", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "`wip`" }] } },
        inputLabels: "`wip`",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    t.assert.snapshot(writes[0].data);
});

test("links the full summary to the docs for the action ref in use", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
        actionRef: "2.0.0",
    });
    const writes = captureSummary();

    main();

    t.assert.snapshot(writes[0].data);
});

test("omits the docs link when the action ref is unset", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "always",
        stepSummaryPath: "/mock/summary.md",
    });
    const writes = captureSummary();

    main();

    assert.doesNotMatch(writes[0].data, /documentation\]/);
    t.assert.snapshot(writes[0].data);
});

test("omits the docs link from the minimal summary even when the ref is set", (t) => {
    stubEvent({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: "bugfix,breaking-change",
        summary: "minimal",
        stepSummaryPath: "/mock/summary.md",
        actionRef: "2.0.0",
    });
    const writes = captureSummary();

    main();

    assert.doesNotMatch(writes[0].data, /documentation\]/);
    t.assert.snapshot(writes[0].data);
});
