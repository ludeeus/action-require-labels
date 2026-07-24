const fs = require("node:fs")

function runAction() {
    const eventPath = process.env.GITHUB_EVENT_PATH

    if (!eventPath || !fs.existsSync(eventPath)) {
        throw new Error(`GITHUB_EVENT_PATH ${eventPath} does not exist`)
    }

    const eventData = JSON.parse(fs.readFileSync(eventPath, { encoding: 'utf8' }))

    if (!eventData.pull_request) {
        throw new Error("This is not a pull request.")
    }

    const inputLabels = process.env.INPUT_LABELS

    if (!inputLabels) {
        throw new Error("No required labels defined for the action.")
    }

    const parsedLabels = inputLabels.split(",").map(label => label.trim()).filter(Boolean)
    const requiredLabels = new Set(parsedLabels)

    if (requiredLabels.size === 0) {
        throw new Error("No required labels defined for the action.")
    }

    if (parsedLabels.length !== requiredLabels.size) {
        console.log("::warning::The labels input contains duplicate labels.")
    }

    const maximumMatchingLabels = resolveMaximumMatchingLabelsCount(requiredLabels.size)

    if (!eventData.pull_request.labels || eventData.pull_request.labels.length === 0) {
        throw new Error(`No labels defined on the pull request. Required labels: ${Array.from(requiredLabels).join(", ")}.`)
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)

    console.log(`Required labels (${escapeData(Array.from(requiredLabels).join(", "))})`)
    console.log(`Pull request labels (${escapeData(prLabels.join(", "))})`)

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request (${escapeData(matchingLabels.join(", "))})`)

    if (matchingLabels.length === 0) {
        throw new Error(`No matching required labels found. Required labels: ${Array.from(requiredLabels).join(", ")}.`)
    }

    if (matchingLabels.length > maximumMatchingLabels) {
        throw new Error(`Found ${matchingLabels.length} matching label(s), but a maximum of ${maximumMatchingLabels} is allowed.`)
    }
}

const resolveMaximumMatchingLabelsCount = (defaultValue) => {
    const input = (process.env.INPUT_MAXIMUM_MATCHING_LABELS || "").trim()
    if (!input) {
        return defaultValue
    }
    if (!/^\d+$/.test(input)) {
        throw new Error("maximum_matching_labels must be a positive integer.")
    }
    const maximum = Number(input)
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
        throw new Error("maximum_matching_labels must be a positive integer.")
    }
    return maximum

// Workflow command data must stay on a single line; see
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
function escapeData(data) {
    return data.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

if (require.main === module) {
    try {
        runAction()
    } catch (err) {
        console.log(`::error::${escapeData(err.message || err.toString())}`)
        process.exitCode = 1
    }
}

module.exports = { runAction }
