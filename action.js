const fs = require("node:fs")

// Errors the action raises intentionally for invalid configuration or input.
// Anything that is not an ActionError is treated as an unexpected failure.
class ActionError extends Error {}

const runAction = () => {
    const eventPath = process.env.GITHUB_EVENT_PATH

    if (!eventPath || !fs.existsSync(eventPath)) {
        throw new ActionError(`GITHUB_EVENT_PATH ${eventPath} does not exist`)
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, { encoding: 'utf8' }))

    if (!eventData.pull_request) {
        throw new ActionError("This is not a pull request.")
    }

    const inputLabels = process.env.INPUT_LABELS

    if (!inputLabels) {
        throw new ActionError("No labels defined for the action.")
    }

    const parsedLabels = inputLabels.split(",").map(label => label.trim()).filter(Boolean)
    const labels = new Set(parsedLabels)

    if (labels.size === 0) {
        throw new ActionError("No labels defined for the action.")
    }

    if (parsedLabels.length !== labels.size) {
        console.log("::warning::The labels input contains duplicate labels.")
    }

    const constraint = resolveRequireConstraint()

    const prLabels = (eventData.pull_request.labels || []).map(label => label.name)

    console.log(`Labels (${escapeData(Array.from(labels).join(", "))})`)
    console.log(`Pull request labels (${escapeData(prLabels.join(", "))})`)

    checkMatchingLabelCount(labels, prLabels, constraint)
}

const resolveRequireConstraint = () => {
    const input = (process.env.INPUT_REQUIRE || "").trim().toLowerCase()
    if (!input || input === "any") {
        return { minimum: 1, maximum: Infinity }
    }
    if (input === "none") {
        return { minimum: 0, maximum: 0 }
    }

    const comparison = /^(<=|>=)?(\d+)$/.exec(input)
    if (!comparison) {
        throw new ActionError("require must be 'any', 'none', a non-negative integer, or a '<=' / '>=' comparison (e.g. '<=2').")
    }

    const count = Number(comparison[2])
    if (!Number.isSafeInteger(count)) {
        throw new ActionError("require must be 'any', 'none', a non-negative integer, or a '<=' / '>=' comparison (e.g. '<=2').")
    }

    if (comparison[1] === "<=") {
        return { minimum: 0, maximum: count }
    }
    if (comparison[1] === ">=") {
        return { minimum: count, maximum: Infinity }
    }
    return { minimum: count, maximum: count }
}

const checkMatchingLabelCount = (labels, prLabels, { minimum, maximum }) => {
    const matchingLabels = prLabels.filter(label => labels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request (${escapeData(matchingLabels.join(", "))})`)

    if (matchingLabels.length < minimum) {
        throw new ActionError(`Found ${matchingLabels.length} matching label(s) on the pull request, but at least ${minimum} of the configured label(s) is required (${Array.from(labels).join(", ")}).`)
    }

    if (matchingLabels.length > maximum) {
        throw new ActionError(`Found ${matchingLabels.length} matching label(s) on the pull request (${matchingLabels.join(", ")}), but at most ${maximum} is allowed.`)
    }
}

// Workflow command data must stay on a single line; see
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
const escapeData = (data) => {
    return data.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

if (require.main === module) {
    try {
        runAction()
    } catch (err) {
        if (err instanceof ActionError) {
            console.log(`::error::${escapeData(err.message)}`)
        } else {
            console.log("::error::Unknown error")
        }
        process.exitCode = 1
    }
}

module.exports = { runAction, ActionError }
