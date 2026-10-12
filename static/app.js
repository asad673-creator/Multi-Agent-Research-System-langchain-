const form = document.getElementById("research-form");
const topicInput = document.getElementById("topic");
const startButton = document.getElementById("start-button");

const workspace = document.getElementById("workspace");
const jobStatus = document.getElementById("job-status");
const activityList = document.getElementById("activity-list");
const results = document.getElementById("results");
const errorMessage = document.getElementById("error-message");

const reportContent = document.getElementById("report-content");
const sourcesList = document.getElementById("sources-list");
const finalFeedback = document.getElementById("final-feedback");
const initialReport = document.getElementById("initial-report");
const initialFeedback = document.getElementById("initial-feedback");

let activeStream = null;
let currentReport = "";


function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
}


function clearError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
}


function addActivity(message) {
    const emptyMessage = activityList.querySelector(".empty-activity");

    if (emptyMessage) {
        emptyMessage.remove();
    }

    const item = document.createElement("li");
    item.textContent = message;
    activityList.prepend(item);
}


function setAgentState(stage, status) {
    const stageToAgent = {
        search: ["search"],
        reader: ["reader"],
        writer: ["writer"],
        revision: ["writer"],
        critic: ["critic"],
        final_review: ["critic"]
    };

    const agentNames = stageToAgent[stage] || [];

    agentNames.forEach((name) => {
        const card = document.querySelector(`[data-agent="${name}"]`);

        if (!card) return;

        const state = card.querySelector(".agent-state");

        if (status === "active") {
            card.classList.add("active");
            card.classList.remove("done");
            state.textContent = "Working";
        } else if (status === "done") {
            card.classList.remove("active");
            card.classList.add("done");
            state.textContent = "Complete";
        }
    });
}


function updateProgress(data) {
    const { stage, message } = data;

    addActivity(message);

    jobStatus.textContent = "Research in progress";

    setAgentState(stage, "active");

    if (stage === "reader") {
        setAgentState("search", "done");
    }

    if (stage === "writer") {
        setAgentState("reader", "done");
    }

    if (stage === "critic") {
        setAgentState("writer", "done");
    }

    if (stage === "final_review") {
        setAgentState("writer", "done");
        setAgentState("critic", "active");
    }

    if (stage === "complete") {
        ["search", "reader", "writer", "critic"].forEach((agent) => {
            setAgentState(agent, "done");
        });
    }
}


function appendSource(source, index) {
    const item = document.createElement("div");
    item.className = "source-item";

    const link = document.createElement("a");
    const title = document.createElement("p");

    let safeUrl = null;

    try {
        const parsedUrl = new URL(source.url);

        if (["http:", "https:"].includes(parsedUrl.protocol)) {
            safeUrl = parsedUrl.href;
        }
    } catch {
        safeUrl = null;
    }

    if (safeUrl) {
        link.href = safeUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Source ${index}: ${safeUrl}`;
    } else {
        link.textContent = `Source ${index}: Invalid URL`;
    }

    title.textContent = source.content || "No source summary available.";

    item.append(link, title);
    sourcesList.appendChild(item);
}


function renderResults(data) {
    currentReport = data.final_report || "No final report was returned.";

    reportContent.textContent = currentReport;
    finalFeedback.textContent =
        data.final_feedback || "No final review was returned.";

    initialReport.textContent =
        data.report || "No initial report was returned.";

    initialFeedback.textContent =
        data.initial_feedback || "No initial feedback was returned.";

    sourcesList.replaceChildren();

    const sources = data.sources || [];

    if (sources.length === 0) {
        sourcesList.textContent = "No sources were collected.";
    } else {
        sources.forEach((source, index) => {
            appendSource(source, index + 1);
        });
    }

    results.hidden = false;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
}


function resetAgentCards() {
    document.querySelectorAll(".agent-card").forEach((card) => {
        card.classList.remove("active", "done");
        card.querySelector(".agent-state").textContent = "Waiting";
    });
}


function closeStream() {
    if (activeStream) {
        activeStream.close();
        activeStream = null;
    }
}


function finishResearch() {
    closeStream();
    startButton.disabled = false;
    startButton.innerHTML = "<span>Start research</span><span>↗</span>";
}


form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const topic = topicInput.value.trim();

    if (!topic) {
        showError("Please enter a research topic.");
        return;
    }

    closeStream();
    clearError();

    workspace.hidden = false;
    results.hidden = true;

    activityList.replaceChildren();
    sourcesList.replaceChildren();

    resetAgentCards();

    jobStatus.textContent = "Starting research";
    startButton.disabled = true;
    startButton.textContent = "Starting...";

    try {
        const response = await fetch("/start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ topic })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Could not start research.");
        }

        addActivity("Research job started.");

        activeStream = new EventSource(
            `/events/${encodeURIComponent(data.job_id)}`
        );

        activeStream.addEventListener("progress", (event) => {
            const progress = JSON.parse(event.data);
            updateProgress(progress);
        });

        activeStream.addEventListener("complete", (event) => {
            const result = JSON.parse(event.data);

            renderResults(result);

            jobStatus.textContent = "Research complete";
            addActivity("All agents finished successfully.");

            finishResearch();
        });

        activeStream.addEventListener("failed", (event) => {
            const failure = JSON.parse(event.data);

            jobStatus.textContent = "Research failed";
            showError(failure.message || "An unexpected error occurred.");

            addActivity("The research job failed.");

            finishResearch();
        });

        activeStream.onerror = () => {
            if (activeStream && activeStream.readyState === EventSource.CLOSED) {
                jobStatus.textContent = "Connection closed";
                showError(
                    "The live connection closed before a result arrived. " +
                    "Check the Flask terminal for errors."
                );
                finishResearch();
            }
        };

    } catch (error) {
        jobStatus.textContent = "Unable to start";
        showError(error.message || "Could not connect to the server.");
        finishResearch();
    }
});


document.getElementById("copy-report").addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(currentReport);

        const button = document.getElementById("copy-report");
        button.textContent = "Copied!";

        setTimeout(() => {
            button.textContent = "Copy report";
        }, 1500);

    } catch {
        showError("Could not copy the report. Please select and copy it manually.");
    }
}); 