@echo off
rem Starts a local server and opens Dream World in the browser.
rem ES modules will not load from a file:// path, so a server is needed.
cd /d "%~dp0"
start "" http://localhost:8123/
python serve.py 8123
