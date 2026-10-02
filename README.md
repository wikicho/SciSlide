# SciSlide

A scientific presentation editor with editable equations, vector output, and an Electron desktop host.

**v0.2.1 is a working prototype.** The shared React/TypeScript editor runs in a browser or Electron. MathJax provides immediate equation previews; the desktop app can explicitly compile equations with installed LaTeX or XeLaTeX on supported Linux systems. The included three-slide cosmology deck uses synthetic demonstration data.

## 실행하기

Node.js 22.12 이상과 pnpm을 사용합니다. 의존성을 설치한 뒤 데스크톱 앱을 실행하세요.

```sh
pnpm install
pnpm desktop
```

`desktop`은 편집기를 빌드하고 Electron 창을 엽니다. 개발 중에는 다음 명령이 Vite와 Electron을 함께 실행합니다.

```sh
pnpm desktop:dev
```

웹 편집기와 정적 빌드도 사용할 수 있습니다.

```sh
pnpm dev
# Open http://127.0.0.1:5173/

pnpm build
pnpm preview
```

`dist/`는 빌드된 정적 앱입니다. 웹 버전은 웹 서버를 통해 실행하세요. Electron은 별도의 웹 서버 없이 번들된 편집기를 `scislide://app/`에서 엽니다. 수식 데이터와 MathJax 글꼴은 번들에 포함되며, 편집 중 CDN이나 원격 수식 서비스에 접속하지 않습니다. 웹 버전에는 서비스 워커나 설치형 PWA가 없습니다.

## 데스크톱 패키지 만들기

```sh
pnpm desktop:package
```

현재 OS와 CPU 아키텍처용 앱을 프로젝트의 `release/`에 생성합니다. Linux x64에서는 `release/SciSlide-linux-x64/scislide`를 실행합니다. `--platform`, `--arch`, `--out`으로 대상을 지정할 수 있고, 기존 결과를 교체하려면 `--overwrite`를 명시합니다. 앱에는 편집기, Electron 런타임, 데스크톱 호스트와 의존성 라이선스가 포함됩니다. TeX 배포판은 포함하지 않습니다.

macOS용 **Apple Silicon과 Intel `.pkg` 설치 프로그램**은 다음 명령으로 함께 만듭니다.

```sh
pnpm desktop:package:mac
# One architecture:
pnpm desktop:package:mac --arch=arm64
```

기본 경로는 `release/SciSlide-0.2.1-macos-arm64-unsigned.pkg`와 `release/SciSlide-0.2.1-macos-x64-unsigned.pkg`이며, 각 파일의 SHA-256 체크섬도 생성합니다. 설치 위치는 `/Applications/SciSlide.app`입니다. [macOS 설치 안내](desktop/MACOS.md)에 아키텍처 선택과 현재 제한을 정리했습니다.

기본 `.pkg` 생성은 [Electron의 공식 순수 JavaScript 패키징](https://packages.electronjs.org/osx-sign/v2.6.0/index.html#pure-javascript-packaging)을 사용하므로 Linux에서도 가능합니다. macOS와 Xcode Command Line Tools가 있으면 `pnpm desktop:package:mac --implementation=native`로 Apple의 `pkgbuild`와 `productbuild`를 사용할 수 있습니다. **두 경로 모두 Developer ID 서명과 notarization이 없는 개발용 설치 프로그램**입니다. macOS의 보안 정책에 따라 설치나 실행이 차단될 수 있습니다. 시스템 보안 설정은 변경하지 않습니다.

저장소의 **macOS development installers** Actions 작업은 macOS runner에서 편집기를 한 번 빌드하고 두 아키텍처를 네이티브 `.pkg`로 만듭니다. Actions의 **Run workflow**로 실행하거나 패키징 설정이 바뀌면 실행됩니다. 버전과 아키텍처 이름을 붙인 installer·checksum·안내문을 30일 보관하는 artifact로 받습니다. 추가 비밀키나 Apple 계정은 사용하지 않습니다. 실제 Mac에서의 설치·편집·파일 저장·출력 검증과 서명된 배포는 별도 단계입니다.

자동 업데이트, macOS notarization, Windows 서명과 세 OS의 전체 배포 검증은 후속 작업입니다.

## 직접 사용하기

1. 왼쪽 썸네일에서 슬라이드를 선택합니다. 좁은 화면에서는 캔버스 위의 슬라이드 선택 메뉴를 사용합니다.
2. **Text / Equation / Figure**로 객체를 추가합니다. 그림은 SVG, PNG, JPEG를 지원합니다.
3. 객체를 클릭하고 드래그해 위치를 바꿉니다. 오른쪽 아래 핸들로 크기를 조절하고, Inspector에서 위치·회전·색상을 입력할 수 있습니다.
4. 수식을 선택한 뒤 **MathJax · Live preview** 또는 **Local LaTeX · Installed packages**를 선택합니다. 수식 원문과 미리보기는 **Apply equation** 전까지 슬라이드에 반영되지 않습니다.
5. 데스크톱 **Open / Save / Save As**는 시스템 파일 창을 사용합니다. Save는 선택한 원본 경로에 저장하고, Save As는 새 경로를 선택합니다. 웹 버전은 원본 파일을 다운로드합니다.
6. **Present**로 발표하고, **Export**에서 전체 슬라이드 PDF 또는 현재 슬라이드 SVG를 저장합니다.

데스크톱 메뉴에는 새 발표, 열기, 저장, 다른 이름으로 저장, undo/redo, 발표와 PDF 출력이 있습니다. 저장 성공 알림은 네이티브 파일 쓰기가 끝난 뒤 표시됩니다. 웹에서는 다운로드 시작과 실제 디스크 저장 완료를 구분합니다.

## 슬라이드 템플릿

**New slide** 또는 슬라이드 목록의 **+**를 누르면 내장 Scientific 템플릿을 고를 수 있습니다. **Research title**, **Key findings**, **Equation + meaning**, **Figure comparison** 네 가지 레이아웃과 **Blank** 빈 슬라이드를 제공합니다. 선택한 레이아웃은 현재 슬라이드 다음에 추가됩니다.

템플릿의 제목·본문·수식·도형은 모두 일반 편집 객체입니다. 텍스트를 바꾸거나 객체를 이동·삭제해 원하는 발표에 맞추세요. 수식은 현재 발표의 수식 글꼴과 색상을 따르며, 예제 식을 직접 수정할 수 있습니다. Figure comparison의 그림 자리는 편집 가능한 사각형과 안내 문구입니다. **Figure**로 실제 그림을 넣고 안내 객체를 삭제하세요. 템플릿은 외부 그림이나 추가 글꼴을 다운로드하지 않습니다.

## MathJax 수식과 AMS 패키지

MathJax 모드에서는 **STIX Two / Fira Math / Latin Modern**을 선택하고 빠르게 미리 볼 수 있습니다. **AMS fonts & symbols / Packages & examples**에서 패키지 목록과 현재 글꼴로 렌더링한 예제를 선택하세요.

`amsmath`, `amsfonts`, `amssymb` 표기는 기본 포함됩니다. `\mathbb`, `\mathfrak`, `\mathcal`, `\mathscr`, `\boldsymbol`, `align`, `aligned`, `cases`, 행렬 등을 사용할 수 있습니다. 지원 패키지 선언을 수식 앞에 적는 것도 가능합니다. 원문은 선언을 포함하여 그대로 저장됩니다.

```latex
\usepackage{amsmath,amsfonts,amssymb}
\mathbb{R}\supset\mathbb{Q}\supset\mathbb{Z}
\qquad \mathfrak{g}\qquad \boldsymbol{\alpha}
```

기본 항목은 **AMS Math, AMS Fonts, AMS Symbols, mathtools, boldsymbol, newcommand, color, braket, cancel, amscd, cases, empheq, extpfeil, gensymb, textmacros, upgreek**입니다. **physics**는 일부 표준 명령의 의미를 바꾸므로 해당 수식에서만 활성화합니다.

```latex
\usepackage{physics}
\pdv{\psi}{t}=\frac{1}{i\hbar}\hat H\ket{\psi}
```

`\require{physics}`도 사용할 수 있습니다. 선언은 원문의 시작 부분에 둡니다. 주석은 허용하며, 패키지 옵션과 지원 목록 밖의 이름은 오류로 알려줍니다. 매크로와 physics 활성화는 다른 수식에 영향을 주지 않습니다.

Fira Math 또는 Latin Modern에 없는 기호는 **해당 기호만 STIX Two의 벡터 글자로 보완**하며 편집기에서 이를 표시합니다. MathJax는 번들된 수학 문법과 준비된 글꼴 데이터를 사용합니다. 컴퓨터에 설치된 `.sty`나 TeX 글꼴을 직접 읽는 기능은 Local LaTeX 모드가 담당합니다. MathJax 지원 범위는 [AMS 문서](https://docs.mathjax.org/en/latest/input/tex/extensions/ams.html)와 각 확장 문서를 따릅니다.

## 설치된 LaTeX 사용하기

**현재 로컬 컴파일은 Linux에서 지원합니다.** 설치된 `latex` 또는 `xelatex`, `dvisvgm`, `bubblewrap`, `prlimit`이 필요합니다. 패키지 검사에는 `kpsewhich`를 사용합니다. Debian/Ubuntu 계열의 설치 예시는 다음과 같습니다.

```sh
sudo apt install texlive-latex-extra texlive-fonts-recommended texlive-science texlive-xetex dvisvgm bubblewrap util-linux
```

앱은 실행 파일과 실제 격리 실행 가능 여부를 검사합니다. 커널이나 시스템 정책이 bubblewrap 격리를 막으면 로컬 컴파일 버튼을 활성화하지 않습니다. MathJax 편집과 이미 저장된 수식 결과의 보기·발표·출력은 계속 사용할 수 있습니다.

1. 수식에서 **Local LaTeX · Installed packages**를 선택합니다.
2. **TeX engine**에서 LaTeX 또는 XeLaTeX를 고릅니다.
3. **PREAMBLE**에 패키지, 매크로와 글꼴 설정을 적고 **LATEX SOURCE**에는 수식 본문을 입력합니다.
4. **Compile with LaTeX**를 누릅니다. 결과를 확인한 뒤 **Apply equation**으로 슬라이드에 반영합니다.

LaTeX 프리앰블 예시:

```latex
\usepackage{amsmath,amsfonts,amssymb,physics}
```

XeLaTeX에서 시스템에 설치된 OpenType 수학 글꼴을 사용하는 예시:

```latex
\usepackage{amsmath}
\usepackage{unicode-math}
\setmathfont{Latin Modern Math}
```

수식은 앱이 생성한 한 페이지 문서 안에서 컴파일됩니다. `\documentclass`, `\begin{document}` 등을 포함한 전체 문서를 붙여 넣는 대신 프리앰블과 본문을 나누어 입력하세요. LaTeX는 **DVI → SVG**, XeLaTeX는 **XDV → SVG** 경로를 사용하며 글자를 벡터 path로 변환합니다. pdfLaTeX와 LuaLaTeX 실행은 현재 제공하지 않습니다.

컴파일은 명시적 버튼 동작입니다. 파일 열기, 발표, 내보내기에서는 원문을 실행하지 않습니다. 컴파일 중 입력을 바꾸거나 수식을 전환하면 이전 작업을 취소하고, 오래된 결과를 적용하지 않습니다. 원문·프리앰블·엔진·크기·색상·display mode를 바꾸면 다시 컴파일해야 합니다. 위치나 회전만 바꾸면 저장된 결과를 재사용합니다.

로컬 작업자는 읽기 전용 시스템 TeX·글꼴 경로와 작업용 임시 디렉터리만 사용합니다. **`~/texmf`, 사용자 홈의 패키지·매크로·글꼴 폴더는 현재 격리 환경에 연결하지 않습니다.** 시스템에 설치된 패키지가 대상이며, 외부 프로그램 실행이나 shell escape를 요구하는 패키지는 지원하지 않습니다. macOS와 Windows에서는 실행 파일 감지는 가능하지만 OS 격리 작업자가 구현될 때까지 로컬 컴파일을 비활성화합니다.

## 원본 파일과 수식 결과의 휴대성

새 `.scislide` 파일의 `formatVersion`은 **`0.2.0`**입니다. 앱은 기존 `0.1.0` 파일을 MathJax 수식으로 마이그레이션하며, 다음 저장부터 0.2.0을 사용합니다. 기존 파일은 열기만으로 수정하지 않습니다. 예전 SciSlide 0.1.x 앱은 새 형식을 읽지 못할 수 있습니다.

```text
presentation.scislide
  manifest.json              Resource sizes, SHA-256 hashes and rendering profiles
  document.json              Slides, editable source, styles and local TeX configuration
  assets/                    Original/sanitized figure assets
  renders/<equation-id>.svg   Successful outlined Local LaTeX results
```

Local LaTeX 수식은 원문, 프리앰블, 엔진, 결과 SVG와 크기, 입력 일치 정보, 컴파일러·변환기 버전 및 사용 의존성의 해시를 보관합니다. SVG는 외부 참조·스크립트·텍스트 글꼴 없이 검증된 벡터 도형으로 저장됩니다. **저장된 유효한 결과는 TeX 없는 컴퓨터나 웹 편집기에서도 보기·발표·PDF/SVG 출력이 가능합니다.** 다시 컴파일하려면 필요한 패키지와 글꼴이 있는 지원 환경이 필요합니다. 원문과 맞지 않거나 빠진 캐시는 오류로 표시하고 출력에서 거부합니다.

## 구현된 기능

- Scientific 슬라이드 템플릿 네 가지와 빈 슬라이드, 추가·복제·삭제·순서 변경, 제목·배경·발표 노트.
- 텍스트, 수식, SVG/PNG/JPEG 그림, 사각형과 타원.
- 이동, 크기 조절, 회전, 투명도, 잠금, 복제, 레이어 순서.
- Shift+클릭 다중 선택, 정렬, 20 px 격자 맞춤과 키보드 이동.
- Undo/redo와 현재 편집 환경의 localStorage 자동 복구.
- ZIP 기반 원본 저장·불러오기, 자산과 수식 결과의 체크섬 검사.
- MathJax 4.1.3과 세 가지 수식 폰트, 17개 패키지 항목과 예제.
- Electron 네이티브 파일 작업, 메뉴와 격리된 Local LaTeX 컴파일.
- PDF와 SVG 출력. 수식과 지원되는 SVG 그림은 벡터로 유지됩니다.

## 현재 제한

- 한글은 편집 화면과 원본 파일에서 사용할 수 있습니다. **PDF 본문은 포함된 Inter Latin 글꼴의 문자 범위만 지원**하며, 한글 등 없는 문자를 발견하면 명확한 오류로 중단합니다. Local LaTeX 수식의 outline 기능이 일반 본문 글꼴 지원을 확장하지는 않습니다. SVG 본문은 브라우저 글꼴 fallback에 따라 다른 컴퓨터에서 모양이 달라질 수 있습니다.
- 그림 crop, PDF 그림 삽입, 애니메이션, 마스터, 협업과 PPTX/Beamer 변환은 아직 없습니다.
- Local LaTeX는 Linux의 시스템 설치 환경을 대상으로 하는 첫 구현입니다. 임의의 전체 문서, 홈 패키지 폴더, 모든 TeX 배포판 경로와 모든 패키지 조합을 보장하지 않습니다.
- SVG 그림의 외부 참조와 활성 콘텐츠는 지원하지 않습니다. PDF에서는 필터·마스크·textPath와 일부 복잡한 SVG 효과를 지원하지 않습니다. 출력 전 오류로 알려줍니다.
- 자동 복구는 웹과 Electron 각각의 localStorage에 저장됩니다. 두 환경의 복구 내용은 자동으로 공유하지 않으며, 큰 그림 여러 장은 용량 제한에 걸릴 수 있습니다. 원본 파일로 저장하세요. 미적용 수식 초안은 복구 대상으로 보장하지 않습니다.
- 전체 MathJax 글꼴 데이터를 포함해 빌드가 큽니다. 분할 로딩과 IndexedDB 자산 저장소는 후속 작업입니다.

## 개발과 검증

```sh
pnpm test
pnpm test:desktop
pnpm build
```

웹 테스트는 문서 검증·구형 파일 마이그레이션·ZIP 왕복·체크섬·SVG sanitization·수식 캐시 일치와 MathJax 패키지/글꼴을 검사합니다. 데스크톱 테스트는 좁은 파일/컴파일 API의 입력 검증과 Linux TeX 격리·컴파일·취소·제한을 검사합니다. TeX 통합 테스트를 실제로 실행하려면 위 도구와 동작 가능한 Linux 격리 환경이 필요합니다. `pnpm build`에는 TypeScript 검사와 프로덕션 빌드가 포함됩니다.

Electron 실행 검증에서는 sandbox/context isolation, Node 접근 차단, 보안 로컬 origin, SHA-256, 번들 글꼴, MathJax, 네이티브 파일 작업과 실제 LaTeX 벡터 결과 전달을 확인했습니다. Linux x64 패키지를 다른 위치로 옮겨 실행한 검증에서도 Compile → Apply, 미적용 초안 유지, 크기 변경 후 재컴파일, 네이티브 저장 → 새 발표 → 다시 열기와 PDF/SVG 출력을 확인했습니다. 설치 프로그램이나 세 OS의 전체 배포 검증을 대신하지는 않습니다.

```text
 desktop/main.cjs              Native window, menu, file operations and IPC validation
 desktop/preload.cjs           Narrow renderer-to-desktop API
 desktop/host-utils.cjs        Testable origin, resource and request validation
 desktop/tex.mjs               Installed TeX detection and isolated compiler worker
 scripts/desktop-dev.mjs       Vite + Electron development launcher
 scripts/package-desktop.mjs   Current-platform application packaging
 src/App.tsx                   Editor, history and equation draft/compile/apply flow
 src/components/SlideScene.tsx Shared editor, thumbnail and slideshow scene
 src/components/MathSupportDialog.tsx  MathJax package catalog and live examples
 src/lib/model.ts              Versioned document model and migration
 src/lib/slide-templates.ts    Editable scientific starter layouts
 src/lib/persistence.ts        Native archive, validation, recovery and figure import
 src/lib/desktop.ts            Typed platform and local compiler contract
 src/lib/equations.ts          MathJax renderer and font profiles
 src/lib/equation-renderer.ts  Renderer selection and saved local-result checks
 src/lib/local-equation-svg.ts Passive outlined SVG validation
 src/lib/export.ts             Vector PDF/SVG exporters and resource preflight
 tests/                        Document, equation, archive and compiler regressions
 public/fonts/                 Bundled Inter TrueType fonts for PDF
 third-party-licenses/         Dependency and font license notices
```

## 이후 개발과 라이선스

우선 작업은 한글 PDF용 글꼴, IndexedDB 자산 저장소, 초안 복구, 그림 crop, 글꼴 데이터 분할 로딩과 데스크톱 배포 검증입니다. macOS/Windows 로컬 TeX 격리 및 명시적으로 선택한 사용자 패키지 폴더 접근은 별도 구현이 필요합니다. 자세한 설계와 후속 요구사항은 [프로젝트 명세서](SciSlide-Project-Specification.md)를 참고하세요.

이 프로토타입은 PPTist 코드를 재사용하지 않았습니다. **새 SciSlide 소스의 프로젝트 라이선스는 아직 선택하지 않았습니다.** 공개 배포 전에 라이선스와 기여 규칙을 확정해야 합니다. 포함된 의존성·글꼴·Electron 런타임은 각자의 라이선스를 유지하며 관련 고지는 `third-party-licenses/`와 패키지 런타임에 보관합니다.
