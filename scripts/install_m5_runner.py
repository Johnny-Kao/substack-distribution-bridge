"""Run locally once to configure the private M5 Substack execution service.

The ChatGPT remote tool does not transfer existing user session credentials.
Invoking this script yourself authorizes copying them only onto your own Mac.
No secret values are printed, logged to GitHub, or uploaded by this script.
"""
import os
import plistlib
import shutil
import subprocess
from pathlib import Path

SOURCE=Path(__file__).resolve().parents[1]
OPS=SOURCE.parent
APP=Path.home()/"Library/Application Support/SubstackBridge"
PLIST=Path.home()/"Library/LaunchAgents/com.johnnykao.substack-runner.plist"
LABEL="com.johnnykao.substack-runner"

def private_copy(source,dest):
    if not source.is_file():
        raise FileNotFoundError("Required local credential file is missing: "+source.name)
    shutil.copyfile(source,dest)
    dest.chmod(0o600)

def main():
    APP.mkdir(parents=True,exist_ok=True)
    APP.chmod(0o700)
    for path in (APP/"scripts",APP/"src",APP/".cache"):
        path.mkdir(parents=True,exist_ok=True)
    (APP/".cache").chmod(0o700)
    shutil.copy2(SOURCE/"scripts/local_runner.py",APP/"scripts/local_runner.py")
    shutil.copytree(OPS/"src/substack_ops",APP/"src/substack_ops",dirs_exist_ok=True)
    private_copy(OPS/".env",APP/".env")
    private_copy(OPS/".cache/cookies.json",APP/".cache/cookies.json")
    private_copy(SOURCE/".cache/runner_key",APP/".cache/runner_key")

    python=APP/".venv/bin/python"
    if not python.is_file():
        subprocess.run(["uv","venv",str(APP/".venv"),"--python","3.12"],check=True)
    subprocess.run(["uv","pip","install","--python",str(python),"httpx>=0.27","python-dotenv>=1","typer>=0.12","rich>=13.7","pyyaml>=6","markdownify>=0.13"],check=True,stdout=subprocess.DEVNULL)
    subprocess.run([str(python),str(APP/"scripts/local_runner.py"),"--check"],check=True,cwd=APP,timeout=40)
    for name in ("stdout","stderr"):
        log=APP/".cache"/("runner_"+name+".log")
        log.touch(exist_ok=True)
        log.chmod(0o600)
    plist={
        "Label":LABEL,
        "ProgramArguments":[str(python),str(APP/"scripts/local_runner.py")],
        "WorkingDirectory":str(APP),
        "StartInterval":300,
        "RunAtLoad":True,
        "StandardOutPath":str(APP/".cache/runner_stdout.log"),
        "StandardErrorPath":str(APP/".cache/runner_stderr.log"),
    }
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    domain=f"gui/{os.getuid()}"
    if PLIST.exists():
        subprocess.run(["launchctl","bootout",domain,str(PLIST)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    PLIST.write_bytes(plistlib.dumps(plist))
    subprocess.run(["launchctl","bootstrap",domain,str(PLIST)],check=True)
    print("M5 runner installed; Cloudflare authenticated; scheduled every 300 seconds.")
    print("No public Substack action was triggered by installation.")

if __name__=="__main__":
    main()
