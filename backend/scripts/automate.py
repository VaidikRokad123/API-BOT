import sys
import time
import argparse
import ctypes
from ctypes import wintypes

# Win32 Constants
SW_RESTORE = 9
SW_SHOW = 5
GMEM_MOVEABLE = 0x0002
CF_UNICODETEXT = 13

# Virtual Key Codes
VK_CONTROL = 0x11
VK_SHIFT = 0x10
VK_V = 0x56
VK_C = 0x43
VK_RETURN = 0x0D
KEYEVENTF_KEYUP = 0x0002

# Load Windows DLLs
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

# Define WINFUNCTYPE for 64-bit compatibility
EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

# Configure User32 and Kernel32 API argtypes and restypes
user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
user32.EnumWindows.restype = wintypes.BOOL

user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int

user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int

user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL

user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.ShowWindow.restype = wintypes.BOOL

user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.restype = wintypes.BOOL

user32.GetForegroundWindow.argtypes = []
user32.GetForegroundWindow.restype = wintypes.HWND

user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD

user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.AttachThreadInput.restype = wintypes.BOOL

kernel32.GetCurrentThreadId.argtypes = []
kernel32.GetCurrentThreadId.restype = wintypes.DWORD

# Clipboard API Prototypes configuration
user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.OpenClipboard.restype = wintypes.BOOL

user32.EmptyClipboard.argtypes = []
user32.EmptyClipboard.restype = wintypes.BOOL

user32.CloseClipboard.argtypes = []
user32.CloseClipboard.restype = wintypes.BOOL

user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.GetClipboardData.restype = wintypes.HANDLE

user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
user32.SetClipboardData.restype = wintypes.HANDLE

kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL

kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = wintypes.LPVOID

kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalUnlock.restype = wintypes.BOOL

# Shortcuts
EnumWindows = user32.EnumWindows
GetWindowText = user32.GetWindowTextW
GetWindowTextLength = user32.GetWindowTextLengthW
IsWindowVisible = user32.IsWindowVisible
ShowWindow = user32.ShowWindow
SetForegroundWindow = user32.SetForegroundWindow
AttachThreadInput = user32.AttachThreadInput
GetWindowThreadProcessId = user32.GetWindowThreadProcessId
GetForegroundWindow = user32.GetForegroundWindow
GetCurrentThreadId = kernel32.GetCurrentThreadId

OpenClipboard = user32.OpenClipboard
EmptyClipboard = user32.EmptyClipboard
GetClipboardData = user32.GetClipboardData
SetClipboardData = user32.SetClipboardData
CloseClipboard = user32.CloseClipboard
GlobalAlloc = kernel32.GlobalAlloc
GlobalLock = kernel32.GlobalLock
GlobalUnlock = kernel32.GlobalUnlock

# Clipboard Utilities (Zero Dependencies)
def set_clipboard_text(text):
    if not OpenClipboard(None):
        return False
    try:
        EmptyClipboard()
        # Encode string as UTF-16 LE with null terminator
        unicode_str = text + '\0'
        size = len(unicode_str) * 2
        h_global = GlobalAlloc(GMEM_MOVEABLE, size)
        if not h_global:
            return False
        ptr = GlobalLock(h_global)
        if not ptr:
            return False
        try:
            ctypes.memmove(ptr, unicode_str, size)
        finally:
            GlobalUnlock(h_global)
        
        if not SetClipboardData(CF_UNICODETEXT, h_global):
            return False
        return True
    finally:
        CloseClipboard()

def get_clipboard_text():
    if not OpenClipboard(None):
        return ""
    try:
        handle = GetClipboardData(CF_UNICODETEXT)
        if not handle:
            return ""
        ptr = GlobalLock(handle)
        if not ptr:
            return ""
        try:
            text = ctypes.wstring_at(ptr)
            return text
        finally:
            GlobalUnlock(handle)
    finally:
        CloseClipboard()


# Keyboard Event Simulation (Zero Dependencies)
def press_key(vk_code):
    user32.keybd_event(vk_code, 0, 0, 0)

def release_key(vk_code):
    user32.keybd_event(vk_code, 0, KEYEVENTF_KEYUP, 0)

def send_paste_and_enter():
    # Press Ctrl+V
    press_key(VK_CONTROL)
    press_key(VK_V)
    time.sleep(0.05)
    release_key(VK_V)
    release_key(VK_CONTROL)
    
    time.sleep(0.1)
    
    # Press Enter
    press_key(VK_RETURN)
    time.sleep(0.05)
    release_key(VK_RETURN)

def send_copy_shortcut():
    # Press Ctrl+Shift+C (Official ChatGPT shortcut to copy last response)
    press_key(VK_CONTROL)
    press_key(VK_SHIFT)
    press_key(VK_C)
    time.sleep(0.05)
    release_key(VK_C)
    release_key(VK_SHIFT)
    release_key(VK_CONTROL)

# Window Focus Utilities
def find_window_by_title(title_substring):
    hwnd_found = [None]
    
    def foreach_window(hwnd, lParam):
        if IsWindowVisible(hwnd):
            length = GetWindowTextLength(hwnd)
            buff = ctypes.create_unicode_buffer(length + 1)
            GetWindowText(hwnd, buff, length + 1)
            title = buff.value
            if title_substring.lower() in title.lower():
                hwnd_found[0] = hwnd
                return False  # Stop searching
        return True
    
    EnumWindows(EnumWindowsProc(foreach_window), 0)
    return hwnd_found[0]

def focus_window(hwnd):
    if not hwnd:
        return False
    # Restore and Show window
    ShowWindow(hwnd, SW_RESTORE)
    ShowWindow(hwnd, SW_SHOW)
    
    # Attach thread inputs to force focus if needed
    fg_hwnd = GetForegroundWindow()
    if fg_hwnd != hwnd:
        fg_thread_id = GetWindowThreadProcessId(fg_hwnd, None)
        curr_thread_id = GetCurrentThreadId()
        
        # Attach
        AttachThreadInput(curr_thread_id, fg_thread_id, True)
        SetForegroundWindow(hwnd)
        # Detach
        AttachThreadInput(curr_thread_id, fg_thread_id, False)
    else:
        SetForegroundWindow(hwnd)
        
    time.sleep(0.5)  # Let system finalize focus shift
    return True

def main():
    parser = argparse.ArgumentParser(description='ChatGPT Desktop Automation')
    parser.add_argument('--title', default='ChatGPT', help='Window title of GPT desktop app')
    args = parser.parse_args()

    # Read prompt from stdin
    prompt = sys.stdin.read().strip()
    if not prompt:
        print("Error: Empty prompt received.", file=sys.stderr)
        sys.exit(1)

    # 1. Find GPT Desktop App
    hwnd = find_window_by_title(args.title)
    if not hwnd:
        print(f"Error: Could not find window containing '{args.title}'", file=sys.stderr)
        sys.exit(1)

    # Focus it
    if not focus_window(hwnd):
        print("Error: Failed to focus window.", file=sys.stderr)
        sys.exit(1)

    # Backup current clipboard content to restore later
    old_clipboard = get_clipboard_text()

    # 2. Copy prompt to clipboard & paste
    if not set_clipboard_text(prompt):
        print("Error: Failed to set clipboard text.", file=sys.stderr)
        sys.exit(1)
        
    # Paste prompt into the active chat
    send_paste_and_enter()
    time.sleep(0.2)
    
    # Clear clipboard so we can track when the response is copied
    set_clipboard_text("")

    # 3. Poll for the response
    # We will press Ctrl+Shift+C every 2 seconds and check the clipboard.
    # When the clipboard content stops changing (i.e. length is stable), the response is complete.
    max_timeout = 60  # Maximum wait time in seconds
    poll_interval = 2.0
    elapsed_time = 0
    
    last_response = ""
    stable_count = 0
    required_stable_checks = 2  # Needs to remain same for 2 intervals (4 seconds) to be considered complete

    # Wait a bit before first poll to let GPT start generating
    time.sleep(2.0)
    elapsed_time += 2.0

    response_found = False

    while elapsed_time < max_timeout:
        # Refocus window before trying to copy (just in case) using the cached hwnd
        focus_window(hwnd)
        
        # Send copy shortcut
        send_copy_shortcut()
        time.sleep(0.3)
        
        current_clipboard = get_clipboard_text().strip()
        
        if current_clipboard:
            # We got a response
            if current_clipboard == last_response:
                stable_count += 1
                if stable_count >= required_stable_checks:
                    response_found = True
                    break
            else:
                # Text is still changing/growing
                last_response = current_clipboard
                stable_count = 0
        else:
            # Clipboard is empty (generation hasn't started or shortcut didn't work yet)
            stable_count = 0
            
        time.sleep(poll_interval)
        elapsed_time += poll_interval + 0.3

    # Restore original clipboard
    if old_clipboard:
        set_clipboard_text(old_clipboard)

    if response_found and last_response:
        # Output the response to stdout for Node server to capture
        print(last_response)
        sys.exit(0)
    elif last_response:
        # Timeout reached, but we got a partial response
        print(last_response)
        sys.exit(0)
    else:
        print("Error: Timeout reached and no response was captured from the app.", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
