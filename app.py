import json
import queue
import threading
import uuid

from flask import Flask, Response, jsonify, render_template, request, stream_with_context

from pipeline import run_research_pipeline


app = Flask(__name__)

jobs = {}
jobs_lock = threading.Lock()


def publish(job_id, event, data):
    with jobs_lock:
        job = jobs.get(job_id)

    if job:
        job.put({
            "event": event,
            "data": data
        })


def run_job(job_id, topic):
    try:
        result = run_research_pipeline(
            topic,
            progress_callback=lambda stage, message: publish(
                job_id,
                "progress",
                {"stage": stage, "message": message}
            )
        )

        publish(job_id, "complete", result)

    except Exception as error:
        app.logger.exception("Research job failed")

        publish(job_id, "failed", {
            "message": f"{type(error).__name__}: {error}"
        })


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/start")
def start_research():
    data = request.get_json(silent=True) or {}
    topic = data.get("topic", "").strip()

    if not topic:
        return jsonify({"error": "Please enter a research topic."}), 400

    if len(topic) > 500:
        return jsonify({"error": "Keep your topic under 500 characters."}), 400

    job_id = uuid.uuid4().hex

    with jobs_lock:
        jobs[job_id] = queue.Queue()

    thread = threading.Thread(
        target=run_job,
        args=(job_id, topic),
        daemon=True
    )
    thread.start()

    return jsonify({"job_id": job_id})


@app.get("/events/<job_id>")
def research_events(job_id):
    with jobs_lock:
        job_queue = jobs.get(job_id)

    if job_queue is None:
        return jsonify({"error": "Research job not found."}), 404

    @stream_with_context
    def event_stream():
        while True:
            try:
                item = job_queue.get(timeout=15)

                payload = json.dumps(item["data"], ensure_ascii=False)
                yield f"event: {item['event']}\ndata: {payload}\n\n"

                if item["event"] in ("complete", "failed"):
                    break

            except queue.Empty:
                yield ": keep-alive\n\n"

        with jobs_lock:
            jobs.pop(job_id, None)

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=5000,
        debug=True,
        threaded=True
    )