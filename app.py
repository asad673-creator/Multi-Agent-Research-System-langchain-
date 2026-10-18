
import json
import queue
import threading

from flask import Flask, render_template, request, Response, stream_with_context
from pipeline import run_research_pipeline

app = Flask(__name__)


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/research", methods=["POST"])
def research():
    data = request.get_json(silent=True) or {}
    topic = data.get("topic", "").strip()

    if not topic:
        return {"error": "Please enter a research topic."}, 400

    events = queue.Queue()

    def send_progress(stage, message):
        events.put({
            "type": "progress",
            "stage": stage,
            "message": message
        })

    def run_pipeline():
        try:
            result = run_research_pipeline(
                topic,
                progress_callback=send_progress
            )

            events.put({
                "type": "complete",
                "report": result.get("final_report", ""),
                "feedback": result.get("final_feedback", ""),
                "sources": result.get("sources", [])
            })

        except Exception as error:
            events.put({
                "type": "error",
                "message": str(error)
            })

        finally:
            events.put(None)

    threading.Thread(
        target=run_pipeline,
        daemon=True
    ).start()

    @stream_with_context
    def generate():
        while True:
            event = events.get()

            if event is None:
                break

            yield json.dumps(event, ensure_ascii=False) + "\n"

    return Response(
        generate(),
        mimetype="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )


if __name__ == "__main__":
    app.run(debug=True, threaded=True)
