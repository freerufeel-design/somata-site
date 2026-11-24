/* Portable Somata launcher, Windows x64, no C runtime. */
typedef unsigned short WCHAR;
typedef unsigned long DWORD;
__declspec(dllimport) DWORD __stdcall GetModuleFileNameW(void *, WCHAR *, DWORD);
__declspec(dllimport) void __stdcall ExitProcess(unsigned int);
__declspec(dllimport) void * __stdcall ShellExecuteW(void *, const WCHAR *, const WCHAR *, const WCHAR *, const WCHAR *, int);
__declspec(dllimport) int __stdcall MessageBoxW(void *, const WCHAR *, const WCHAR *, unsigned int);
static WCHAR directory[32768];
static WCHAR script[32768];
static const WCHAR suffix[] = L"app\\start.bat";
static void fail(void) {
    MessageBoxW(0, L"Cannot launch app\\start.bat. Keep the Somata project folder intact.", L"Somata", 0x10);
    ExitProcess(1);
}
void entry(void) {
    DWORD n = GetModuleFileNameW(0, directory, 32768);
    if (!n || n >= 32768) { fail(); return; }
    while (n && directory[n-1] != '\\' && directory[n-1] != '/') --n;
    if (!n || n + sizeof(suffix)/sizeof(suffix[0]) > 32768) { fail(); return; }
    directory[n] = 0;
    for (DWORD i = 0; i < n; ++i) script[i] = directory[i];
    for (DWORD i = 0; i < sizeof(suffix)/sizeof(suffix[0]); ++i) script[n+i] = suffix[i];
    /* Fully qualified file and working directory, derived only from this exe. */
    if ((unsigned long long)ShellExecuteW(0, L"open", script, 0, directory, 1) <= 32) { fail(); return; }
    ExitProcess(0);
}
