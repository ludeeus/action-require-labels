const fs = require("fs");

function runAction() {
    const eventData = fs.readFileSync(process.env.GITHUB_EVENT_PATH)
    console.log(eventData.pull_request)
}





runAction();