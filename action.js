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

    if (!eventData.pull_request.labels || eventData.pull_request.labels.length === 0) {
        throw new Error("No labels defined on the pull request.")
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
        logMessage("The labels input contains duplicate labels.", { severity: "warning" })
    }

    let maximumMatchingLabels = requiredLabels.size

    const inputMaximum = (process.env.INPUT_MAXIMUM_MATCHING_LABELS || "").trim()
    if (inputMaximum) {
        if (!/^\d+$/.test(inputMaximum) || Number(inputMaximum) < 1) {
            throw new Error("maximum_matching_labels must be a positive integer.")
        }
        maximumMatchingLabels = Number(inputMaximum)
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)

    logMessage(`Required labels (${Array.from(requiredLabels).join(",")})`, { severity: "info" })
    logMessage(`Pull request labels (${prLabels.join(",")})`, { severity: "info" })

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    logMessage(`Found ${matchingLabels.length} matching label(s) on the pull request (${matchingLabels.join(",")})`, { severity: "info" })

    if (matchingLabels.length === 0) {
        throw new Error("No matching required labels found.")
    }

    if (matchingLabels.length > maximumMatchingLabels) {
        throw new Error(`Found ${matchingLabels.length} matching label(s), but a maximum of ${maximumMatchingLabels} is allowed.`)
    }
}

// Workflow command data must stay on a single line; see
// https://docs.github.com/actions/reference/workflow-commands-for-github-actions
function escapeData(data) {
    return data.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")
}

// Emits a GitHub Action log line for the given severity. `debug`, `notice`,
// `warning` and `error` map to workflow commands (escaped so they stay on a
// single line); `info` is printed as plain output. Severity defaults to `debug`.
function logMessage(message, options = {}) {
    const severity = options.severity || "debug"
    switch (severity) {
        case "error":
            console.log(`::error::${escapeData(message)}`)
            break
        case "warning":
            console.log(`::warning::${escapeData(message)}`)
            break
        case "notice":
            console.log(`::notice::${escapeData(message)}`)
            break
        case "info":
            console.log(message)
            break
        case "debug":
        default:
            console.log(`::debug::${escapeData(message)}`)
            break
    }
}

if (require.main === module) {
    try {
        runAction()
    } catch (err) {
        logMessage(err.message || err.toString(), { severity: "error" })
        process.exitCode = 1
    }
}

module.exports = { runAction, logMessage }
