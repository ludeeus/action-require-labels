const fs = require("node:fs")

// Errors the action raises intentionally for invalid configuration or input.
// Anything that is not an ActionError is treated as an unexpected failure.
class ActionError extends Error {}

const runAction = () => {
    const { eventData, requiredLabels, maximumMatchingLabelsCount } = resolveConfiguration()
    const requiredLabelsList = Array.from(requiredLabels).join(", ")

    if (!eventData.pull_request.labels || eventData.pull_request.labels.length === 0) {
        throw new ActionError(`No labels defined on the pull request. Required labels: ${requiredLabelsList}.`)
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)

    console.log(`Required labels (${escapeData(requiredLabelsList)})`)
    console.log(`Pull request labels (${escapeData(prLabels.join(", "))})`)

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request (${escapeData(matchingLabels.join(", "))})`)

    if (matchingLabels.length === 0) {
        throw new ActionError(`No matching required labels found. Required labels: ${requiredLabelsList}.`)
    }

    if (matchingLabels.length > maximumMatchingLabelsCount) {
        throw new ActionError(`Found ${matchingLabels.length} matching label(s), but a maximum of ${maximumMatchingLabelsCount} is allowed.`)
    }
}

const resolveConfiguration = () => {
    const eventPath = process.env.GITHUB_EVENT_PATH

    if (!eventPath || !fs.existsSync(eventPath)) {
        throw new ActionError(`GITHUB_EVENT_PATH ${eventPath} does not exist`)
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, { encoding: 'utf8' }))

    if (!eventData.pull_request) {
        throw new ActionError("This is not a pull request.")
    }

    const requiredLabels = resolveRequiredLabels()
    const maximumMatchingLabelsCount = resolveMaximumMatchingLabelsCount(requiredLabels.size)

    return { eventData, requiredLabels, maximumMatchingLabelsCount }
}

const resolveRequiredLabels = () => {
    const inputLabels = process.env.INPUT_LABELS

    if (!inputLabels) {
        throw new ActionError("No required labels defined for the action.")
    }

    const parsedLabels = inputLabels.split(",").map(label => label.trim()).filter(Boolean)
    const requiredLabels = new Set(parsedLabels)

    if (requiredLabels.size === 0) {
        throw new ActionError("No required labels defined for the action.")
    }

    if (parsedLabels.length !== requiredLabels.size) {
        console.log("::warning::The labels input contains duplicate labels.")
    }

    return requiredLabels
}

const resolveMaximumMatchingLabelsCount = (defaultValue) => {
    const input = (process.env.INPUT_MAXIMUM_MATCHING_LABELS || "").trim()
    if (!input) {
        return defaultValue
    }
    if (!/^\d+$/.test(input)) {
        throw new ActionError("maximum_matching_labels must be a positive integer.")
    }
    const maximum = Number(input)
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
        throw new ActionError("maximum_matching_labels must be a positive integer.")
    }
    return maximum
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
