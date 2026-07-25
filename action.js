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

// Keeps a label-derived value inside a single, unbroken markdown table cell.
const escapeMarkdown = (text) => text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")

// Renders a label as a markdown code span. A backslash is literal inside a code
// span, so a backtick in the label cannot be escaped — the fence is widened past
// the longest backtick run instead. GFM still requires escaping the table's own
// pipe delimiter, even within a code span.
const asCodeSpan = (label) => {
    const content = label.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
    const backtickRuns = Array.from(content.matchAll(/`+/g), (match) => match[0].length)
    const fence = "`".repeat(Math.max(0, ...backtickRuns) + 1)
    const padding = content.startsWith("`") || content.endsWith("`") ? " " : ""
    return `${fence}${padding}${content}${padding}${fence}`
}

// The action's own repository and ref (tag/branch/SHA) from `uses:`, so the
// summary links to the documentation matching the version in use. Both are
// unset for a local action (`uses: ./`), where no link is rendered.
const resolveDocumentationLink = () => {
    const repository = process.env.GITHUB_ACTION_REPOSITORY
    const ref = process.env.GITHUB_ACTION_REF
    if (!repository || !ref) {
        return null
    }
    return `[${repository}@${ref} documentation](https://github.com/${repository}/blob/${ref}/README.md)`
}

const buildSummary = ({ requiredLabels, prLabels, matchingLabels, maximumMatchingLabelsCount, failureMessage, minimal, documentationLink }) => {
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
        ...(documentationLink ? [documentationLink, ""] : []),
    ]

    return ["## Required labels", "", statusLine, "", ...table].join("\n")
}

const writeSummary = (result) => {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY
    if (!summaryPath) {
        return
    }
    fs.appendFileSync(summaryPath, buildSummary({
        ...result,
        minimal: result.summaryMode.minimal,
        documentationLink: resolveDocumentationLink(),
    }))
}

const main = () => {
    try {
        const result = runAction()

        if (shouldWriteSummary(result.summaryMode, result.failureMessage !== null)) {
            writeSummary(result)
        }

        if (result.failureMessage) {
            console.log(`::error::${escapeData(result.failureMessage)}`)
            process.exitCode = 1
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
