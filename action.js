const fs = require("node:fs")

// Errors the action raises intentionally for invalid configuration or input.
// Anything that is not an ActionError is treated as an unexpected failure.
class ActionError extends Error {}

const runAction = () => {
    const { eventData, requiredLabels, maximumMatchingLabelsCount, summaryMode } = resolveConfiguration()
    const requiredLabelsList = Array.from(requiredLabels).join(", ")

    const prLabels = (eventData.pull_request.labels || []).map(label => label.name)

    console.log(`Required labels (${escapeData(requiredLabelsList)})`)
    console.log(`Pull request labels (${escapeData(prLabels.join(", "))})`)

    const matchingLabels = prLabels.filter(label => requiredLabels.has(label))
    console.log(`Found ${matchingLabels.length} matching label(s) on the pull request (${escapeData(matchingLabels.join(", "))})`)

    const failureMessage = resolveFailureMessage({ requiredLabelsList, prLabels, matchingLabels, maximumMatchingLabelsCount })

    return { summaryMode, requiredLabels, prLabels, matchingLabels, maximumMatchingLabelsCount, failureMessage }
}

const resolveFailureMessage = ({ requiredLabelsList, prLabels, matchingLabels, maximumMatchingLabelsCount }) => {
    if (prLabels.length === 0) {
        return `No labels defined on the pull request. Required labels: ${requiredLabelsList}.`
    }
    if (matchingLabels.length === 0) {
        return `No matching required labels found. Required labels: ${requiredLabelsList}.`
    }
    if (matchingLabels.length > maximumMatchingLabelsCount) {
        return `Found ${matchingLabels.length} matching label(s), but a maximum of ${maximumMatchingLabelsCount} is allowed.`
    }
    return null
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
    const summaryMode = resolveSummaryMode()

    return { eventData, requiredLabels, maximumMatchingLabelsCount, summaryMode }
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

const SUMMARY_MODES = {
    never: null,
    always: { errorOnly: false, minimal: false },
    error: { errorOnly: true, minimal: false },
    minimal: { errorOnly: false, minimal: true },
    minimal_error: { errorOnly: true, minimal: true },
}

const resolveSummaryMode = () => {
    const name = (process.env.INPUT_SUMMARY || "").trim().toLowerCase() || "never"
    if (!Object.hasOwn(SUMMARY_MODES, name)) {
        throw new ActionError(`summary must be one of: ${Object.keys(SUMMARY_MODES).join(", ")}.`)
    }
    return SUMMARY_MODES[name]
}

const shouldWriteSummary = (mode, failed) => mode !== null && (!mode.errorOnly || failed)

// CommonMark counts a lone carriage return as a line ending, not just CRLF and
// LF, so every variant has to collapse or the value escapes its row.
const collapseLineEndings = (text) => text.replace(/\r\n|[\r\n]/g, " ")

// Keeps a label-derived value on a single line and rendering as literal text.
// The value is only ever embedded mid-line, so characters that are markup solely
// at the start of a line (`#`, `-`, `1.`) cannot take effect and are left alone;
// everything that can open an inline construct is escaped.
const escapeMarkdown = (text) => collapseLineEndings(text.replace(/[\\`*_[\]<>&~|]/g, "\\$&"))

// Renders a label as a markdown code span. A backslash cannot escape a backtick
// inside a code span, so the fence is widened past the longest backtick run
// instead. GFM does resolve `\|` while splitting table cells, so the pipe is
// escaped there — and a literal backslash is doubled first, otherwise a backslash
// immediately before a pipe would consume that escape and leave the delimiter
// bare, breaking the row.
const asCodeSpan = (label) => {
    const content = collapseLineEndings(label.replace(/\\/g, "\\\\").replace(/\|/g, "\\|"))
    const backtickRuns = Array.from(content.matchAll(/`+/g), (match) => match[0].length)
    const fence = "`".repeat(Math.max(0, ...backtickRuns) + 1)
    const padding = content.startsWith("`") || content.endsWith("`") ? " " : ""
    return `${fence}${padding}${content}${padding}${fence}`
}

const ACTION_REPOSITORY = "ludeeus/action-require-labels"
const DOCUMENTATION_LINK = `[${ACTION_REPOSITORY} documentation](https://github.com/${ACTION_REPOSITORY}#readme)`

const buildSummary = ({ requiredLabels, prLabels, matchingLabels, maximumMatchingLabelsCount, failureMessage, minimal }) => {
    const labelCell = (labels) => labels.length === 0 ? "_(none)_" : labels.map(asCodeSpan).join(", ")
    const capNote = maximumMatchingLabelsCount < requiredLabels.size ? ` (max ${maximumMatchingLabelsCount} allowed)` : ""
    const statusLine = failureMessage
        ? `❌ **Failed** — ${escapeMarkdown(failureMessage)}`
        : `✅ **Passed** — ${matchingLabels.length} of ${requiredLabels.size} required labels present${capNote}.`

    const table = minimal ? [] : [
        "| Group | Labels |",
        "| --- | --- |",
        `| Required | ${labelCell(Array.from(requiredLabels))} |`,
        `| Present | ${labelCell(prLabels)} |`,
        `| Matched | ${labelCell(matchingLabels)} |`,
        "",
        DOCUMENTATION_LINK,
        "",
    ]

    return ["## Required labels", "", statusLine, "", ...table].join("\n")
}

const writeSummary = (result) => {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (!summaryPath) {
        return
    }
    fs.appendFileSync(summaryPath, buildSummary({ ...result, minimal: result.summaryMode.minimal }))
}

const main = () => {
    try {
        const result = runAction()

        if (shouldWriteSummary(result.summaryMode, result.failureMessage !== null)) {
            writeSummary(result)
        }

        if (result.failureMessage) {
            throw new ActionError(result.failureMessage)
        }
    } catch (err) {
        if (err instanceof ActionError) {
            console.log(`::error::${escapeData(err.message)}`)
        } else {
            console.log("::error::Unknown error")
        }
        process.exitCode = 1
    }
}

if (require.main === module) {
    main()
}

module.exports = { runAction, main, ActionError }
