import sys
import time
import subprocess

def test_automation():
    print("=" * 60)
    print("ChatGPT Desktop Automation - Diagnostics Script")
    print("=" * 60)
    print("This script will test if your python environment can interact")
    print("with the ChatGPT Desktop app.")
    print()
    print("Requirements:")
    print("1. The ChatGPT desktop app must be open and visible on screen.")
    print("2. Do not move your mouse or use your keyboard during the test.")
    print()
    
    window_title = input("Enter ChatGPT Window Title (Default is 'ChatGPT'): ").strip() or "ChatGPT"
    test_prompt = input("Enter a quick test prompt (Default is 'Hello, reply in 2 words'): ").strip() or "Hello, reply in 2 words"
    
    print(f"\n[Diagnostic] Starting automation test in 3 seconds...")
    print("[Diagnostic] PLEASE ACTIVATE / OPEN YOUR CHATGPT WINDOW NOW IF MINIMIZED.")
    for i in range(3, 0, -1):
        print(f"{i}...")
        time.sleep(1)
        
    print("\n[Diagnostic] Spawning automate.py process...")
    
    try:
        # Start automate.py as a subprocess
        process = subprocess.Popen(
            ['python', 'automate.py', '--title', window_title],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Send the test prompt
        print(f"[Diagnostic] Sending prompt: '{test_prompt}'")
        stdout, stderr = process.communicate(input=test_prompt)
        
        if process.returncode == 0:
            print("\n" + "=" * 60)
            print("SUCCESS! Automation worked perfectly.")
            print("=" * 60)
            print("Captured Response:")
            print("-" * 60)
            print(stdout.strip())
            print("-" * 60)
        else:
            print("\n" + "!" * 60)
            print("FAILURE! Automation script returned an error.")
            print("!" * 60)
            print("Error details:")
            print(stderr.strip())
            print()
            print("Troubleshooting steps:")
            print("1. Make sure the ChatGPT Desktop window is open and NOT running as administrator (if python is not admin).")
            print("2. Check if the window title matches. The script searches case-insensitively for the title substring.")
            print("3. Try changing the target window title in backend/.env to match your app.")
            
    except Exception as e:
        print(f"\n[Diagnostic] Execution failed with exception: {e}")

if __name__ == '__main__':
    test_automation()
