
const form = document.getElementById("research-form");
const topicInput = document.getElementById("topic");
const submitButton = document.getElementById("submit-btn");
const buttonText = document.getElementById("button-text");

const workspace = document.getElementById("workspace");
const progressList = document.getElementById("progress-list");
const statusBadge = document.getElementById("status-badge");
const results = document.getElementById("results");
const errorBox = document.getElementById("error-box");

const reportContent = document.getElementById("report-content");
const feedbackContent = document.getElementById("feedback-content");
const sourcesContent = document.getElementById("sources-content");
const copyButton = document.getElementById("copy-btn");


function addProgress(stage, message) {
    const item = document.createElement("div");
    item.className = "progress-item";

    const dot = document.createElement("span");
    dot.className = "progress-dot";

    const content = document.createElement("div");

    const title = document.createElement("strong");
    title.textContent = stage.replaceAll("_", " ");

    const description = document.createElement("p");
    description.textContent = message;

    content.append(title, description);
    item.append(dot, content);
    progressList.appendChild(item);
}


function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
    statusBadge.textContent = "Error";
}


function displaySources(sources) {
    sourcesContent.replaceChildren();

    if (!sources || sources.length === 0) {
        sourcesContent.textContent = "No sources were returned.";
        return;
    }

    sources.forEach((source) => {
        const item = document.createElement("div");
        item.className = "source-item";

        const link = document.createElement("a");
        link.textContent = source.url || "Unknown URL";
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        try {
            const url = new URL(source.url);
            if (["http:", "https:"].includes(url.protocol)) {
                link.href = url.href;
            } else {
                link.removeAttribute("target");
            }
        } catch {
            link.removeAttribute("target");
        }

        const content = document.createElement("p");
        content.textContent = source.content || "No content returned.";

        item.append(link, content);
        sourcesContent.appendChild(item);
    });
}


form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const topic = topicInput.value.trim();

    if (!topic) {
        showError("Please enter a research topic.");
        return;
    }

    submitButton.disabled = true;
    buttonText.textContent = "Researching...";
    workspace.classList.remove("hidden");
    results.classList.add("hidden");
    errorBox.classList.add("hidden");

    progressList.replaceChildren();
    reportContent.textContent = "";
    feedbackContent.textContent = "";
    sourcesContent.replaceChildren();

    statusBadge.textContent = "Running";
    statusBadge.className = "status-badge running";

    try {
        const response = await fetch("/research", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ topic })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || "Unable to start research.");
        }

        if (!response.body) {
            throw new Error("Your browser does not support streaming responses.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completed = false;

        async function handleLine(line) {
            if (!line.trim()) return;

            const event = JSON.parse(line);

            if (event.type === "progress") {
                addProgress(event.stage, event.message);
            }

            if (event.type === "complete") {
                reportContent.textContent = event.report || "No report returned.";
                feedbackContent.textContent =
                    event.feedback || "No critic feedback returned.";

                displaySources(event.sources);

                results.classList.remove("hidden");
                statusBadge.textContent = "Complete";
                statusBadge.className = "status-badge complete";
                completed = true;
            }

            if (event.type === "error") {
                throw new Error(event.message || "Research failed.");
            }
        }

        while (true) {
            const { value, done } = await reader.read();

            buffer += decoder.decode(value || new Uint8Array(), {
                stream: !done
            });

            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                await handleLine(line);
            }

            if (done) break;
        }

        if (buffer.trim()) {
            await handleLine(buffer);
        }

        if (!completed) {
            throw new Error("The research stream ended before completion.");
        }

    } catch (error) {
        showError(error.message || "Something went wrong.");
    } finally {
        submitButton.disabled = false;
        buttonText.textContent = "Start research";
    }
});


copyButton.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(reportContent.textContent);
        copyButton.textContent = "Copied!";

        setTimeout(() => {
            copyButton.textContent = "Copy report";
        }, 1500);
    } catch {
        showError("Could not copy the report. Please select and copy it manually.");
    }
});
