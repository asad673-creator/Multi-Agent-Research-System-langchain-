
import os
import socket
import ipaddress
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from tavily import TavilyClient
from langchain.tools import tool

load_dotenv()

api_key = os.getenv("TAVILY_API_KEY")

if not api_key:
    raise ValueError("TAVILY_API_KEY is missing from .env")

tavily = TavilyClient(api_key=api_key)


def validate_url(url: str) -> bool:
    try:
        parsed = urlparse(url)

        if parsed.scheme not in ("http", "https"):
            return False

        if not parsed.hostname:
            return False

        if parsed.username or parsed.password:
            return False

        hostname = parsed.hostname

        try:
            addresses = [ipaddress.ip_address(hostname)]
        except ValueError:
            addresses = [
                ipaddress.ip_address(info[4][0])
                for info in socket.getaddrinfo(
                    hostname,
                    None,
                    type=socket.SOCK_STREAM
                )
            ]

        return all(address.is_global for address in addresses)

    except (ValueError, OSError):
        return False


# TOOL 1: WEB SEARCH

@tool
def web_search(query: str) -> str:
    """Search the web and return titles, URLs, and relevant snippets."""

    if not query.strip():
        return "Error: Search query cannot be empty."

    try:
        response = tavily.search(
            query=query,
            max_results=5
        )

        results = response.get("results", [])

        if not results:
            return "No search results found."

        output = []

        for result in results:
            output.append(
                f"Title: {result.get('title', 'Unknown')}\n"
                f"URL: {result.get('url', '')}\n"
                f"Snippet: {result.get('content', '')[:500]}"
            )

        return "\n\n---\n\n".join(output)

    except Exception as e:
        return f"Search failed: {type(e).__name__}: {e}"


# TOOL 2: WEB SCRAPER

@tool
def scrape_url(url: str) -> str:
    """Scrape readable text from a public HTML webpage."""

    if not validate_url(url):
        return "Error: Invalid or non-public URL."

    try:
        with requests.get(
            url,
            timeout=(3, 10),
            headers={"User-Agent": "Mozilla/5.0"},
            allow_redirects=False,
            stream=True
        ) as response:

            if 300 <= response.status_code < 400:
                return (
                    "Error: The webpage redirected to another URL. "
                    "Validate the destination before scraping it."
                )

            response.raise_for_status()

            content_type = response.headers.get(
                "Content-Type", ""
            ).lower()

            if "text/html" not in content_type:
                return "Error: URL does not return HTML content."

            content_length = response.headers.get("Content-Length")

            if content_length:
                try:
                    if int(content_length) > 5_000_000:
                        return "Error: Webpage exceeds the size limit."
                except ValueError:
                    pass

            content = response.raw.read(
                5_000_001,
                decode_content=True
            )

            if len(content) > 5_000_000:
                return "Error: Webpage exceeds the size limit."

        soup = BeautifulSoup(content, "html.parser")

        for tag in soup([
            "script", "style", "nav", "footer",
            "header", "aside", "form", "noscript"
        ]):
            tag.decompose()

        main = (
            soup.find("main")
            or soup.find("article")
            or soup.body
            or soup
        )

        text = main.get_text(separator=" ", strip=True)
        text = " ".join(text.split())

        if not text:
            return "No readable text found on this webpage."

        return text[:10000]

    except requests.RequestException as e:
        return f"Scraping failed: {type(e).__name__}: {e}"

    except Exception as e:
        return f"Unexpected error: {type(e).__name__}: {e}"
