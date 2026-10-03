; Inno Setup 6.7+ is available on the pinned Windows GitHub Actions runner.
; The Electron app and Setup loader are AMD64; Inno Setup 6's inner wizard is x86.
#ifndef AppVersion
  #error AppVersion must be supplied by package-windows.mjs
#endif
#ifndef AppSource
  #error AppSource must be supplied by package-windows.mjs
#endif
#ifndef InstallerOutput
  #error InstallerOutput must be supplied by package-windows.mjs
#endif
#ifndef InstallerName
  #error InstallerName must be supplied by package-windows.mjs
#endif

[Setup]
AppId={{27CD38AA-1316-4854-90CE-C3A5F02A35E7}
AppName=SciSlide
AppVersion={#AppVersion}
AppPublisher=SciSlide contributors
AppPublisherURL=https://github.com/wikicho/SciSlide
AppSupportURL=https://github.com/wikicho/SciSlide/issues
AppUpdatesURL=https://github.com/wikicho/SciSlide
DefaultDirName={localappdata}\Programs\SciSlide
DefaultGroupName=SciSlide
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UseSetupLdr=x64
MinVersion=10.0
OutputDir={#InstallerOutput}
OutputBaseFilename={#InstallerName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\scislide.exe
UninstallDisplayName=SciSlide
CloseApplications=yes
RestartApplications=no
SetupLogging=yes
SignedUninstaller=no

[Files]
Source: "{#AppSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\SciSlide"; Filename: "{app}\scislide.exe"; WorkingDir: "{app}"

[Run]
Filename: "{app}\scislide.exe"; Description: "Launch SciSlide"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
