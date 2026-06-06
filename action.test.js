const { test } = require("node:test");
const assert = require("node:assert/strict");

const { runAction } = require("./action.js");

// Builds a fully-mocked dependency set. Nothing here touches the real
// environment or filesystem; overrides customise individual branches.
function mockDeps(overrides = {}) {
    const {
        eventPath = "/mock/event.json",
        inputLabels = "bugfix",
        exists = true,
        event = { pull_request: { labels: [{ name: "bugfix" }] } },
    } = overrides;

    return {
        eventPath,
        inputLabels,
        existsSync: () => exists,
        readFileSync: () => JSON.stringify(event),
    };
}

test("throws when the event path is not set", () => {
    assert.throws(
        () => runAction(mockDeps({ eventPath: "" })),
        /GITHUB_EVENT_PATH .* does not exist/,
    );
});

test("throws when the event file does not exist", () => {
    assert.throws(
        () => runAction(mockDeps({ exists: false })),
        /GITHUB_EVENT_PATH .* does not exist/,
    );
});

test("throws when the event is not a pull request", () => {
    assert.throws(
        () => runAction(mockDeps({ event: { push: {} } })),
        /This is not a pull request\./,
    );
});

test("throws when the pull request has no labels property", () => {
    assert.throws(
        () => runAction(mockDeps({ event: { pull_request: {} } })),
        /No labels defined on the pull request\./,
    );
});

test("throws when the pull request has an empty labels array", () => {
    assert.throws(
        () => runAction(mockDeps({ event: { pull_request: { labels: [] } } })),
        /No labels defined on the pull request\./,
    );
});

test("throws when no required labels are defined for the action", () => {
    assert.throws(
        () => runAction(mockDeps({ inputLabels: "" })),
        /No required labels defined for the action\./,
    );
});

test("throws when none of the PR labels match the required labels", () => {
    assert.throws(
        () => runAction(mockDeps({
            event: { pull_request: { labels: [{ name: "documentation" }, { name: "question" }] } },
            inputLabels: "bugfix,breaking-change,new-feature",
        })),
        /No matching required labels found\./,
    );
});

test("succeeds when at least one PR label matches a required label", () => {
    assert.doesNotThrow(() => runAction(mockDeps({
        event: { pull_request: { labels: [{ name: "bugfix" }, { name: "question" }] } },
        inputLabels: "bugfix,breaking-change,new-feature",
    })));
});

test("trims whitespace around required labels before matching", () => {
    assert.doesNotThrow(() => runAction(mockDeps({
        event: { pull_request: { labels: [{ name: "bugfix" }] } },
        inputLabels: " bugfix , breaking-change , new-feature ",
    })));
});
