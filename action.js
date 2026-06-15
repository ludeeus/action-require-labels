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

    const requiredLabels = new Set(inputLabels.split(",").map(label => label.trim()).filter(Boolean))

    if (requiredLabels.size === 0) {
        throw new Error("No required labels defined for the action.")
    }

    const prLabels = eventData.pull_request.labels.map(label => label.name)

    console.log(`Required labels (${Array.from(requiredLabels).join(",")})`)
    console.log(`Pull request labels (${prLabels.join(",")})`)

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request (${matchingLabels.join(",")})`)

    setOutput("matching_label_count", matchingLabels.length)

    if (matchingLabels.length === 0) {
        throw new Error("No matching required labels found.")
    }
}

// Appends "name=value" to the GITHUB_OUTPUT file; no-op when unset.
function setOutput(name, value) {
    const outputPath = process.env.GITHUB_OUTPUT
    if (!outputPath) {
        return
    }

    if (!name) {
        throw new Error("Output name must not be empty.")
    }

    if (/[\r\n=]/.test(name)) {
        throw new Error(`Output name "${name}" must not contain "=", a newline or a carriage return.`)
    }

    const stringValue = String(value)

    if (/[\r\n]/.test(stringValue)) {
        throw new Error(`Output "${name}" must not contain a newline or carriage return.`)
    }

    fs.appendFileSync(outputPath, `${name}=${stringValue}\n`)
}

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

module.exports = { runAction, setOutput }
