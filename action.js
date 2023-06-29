const fs = require("fs");

function runAction() {
    console.log(process.env.GITHUB_EVENT_PATH)
    const eventData = fs.readFileSync('student.json')
}





runAction();