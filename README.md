#

# [English](#en-tanki-tweaks-client) | [Русский](#ru-tanki-tweaks-client)

---

# [EN] Tanki Tweaks Client

**An alternative client for the game "Tanki Online".**

> [🌐 **Discord**](https://discord.gg/hJn2QeJsT3) • [🌐 **Telegram**](https://t.me/tanki_projects) • [❤️ **Boosty**](https://boosty.to/tanki-projects)

## 📥 Downloads

> ⚠️ On macOS, before mounting the dmg file with the application, it is necessary to clear its attributes using the following command in Terminal:
>
> ```shell
> xattr -c <path to dmg>
> ```

| OS          | Architecture          | Link       |
|-------------|-----------------------|------------|
| **Windows** | x64 *(Intel, AMD)*    | [Download](https://github.com/tettov/tanki-tweaks-client/releases/download/1.1.2/to-1.1.2-win32-x64.exe) |
| **macOS**   | ARM *(Apple silicon)* | [Download](https://github.com/tettov/tanki-tweaks-client/releases/download/1.1.2/to-1.1.2-darwin-arm64.dmg) |
| **macOS**   | x64 *(Intel)*         | [Download](https://github.com/tettov/tanki-tweaks-client/releases/download/1.1.2/to-1.1.2-darwin-x64.dmg) |

> ℹ️ Since the application lacks a digital signature, your OS may warn about potential risks. Follow the instructions for your OS to proceed with installation and launching.

## ✨ Key Features

- All features of [**Tanki Tweaks**](https://chromewebstore.google.com/detail/tanki-tweaks/khcoecipddmigggaeokhmhmhjhlpcpnb) — a browser extension.

- Up-to-date browser engine with improved performance and bug fixes.

- Support for custom extensions.

- Compatibility with Windows 10 and 11, macOS, and Debian/Ubuntu.

## 🛠️ Building from Source

1. Install [**Node.js**](https://nodejs.org) and [**Git**](https://git-scm.com). During installation, leave the default settings unless you're certain of changes.

   On Debian/Ubuntu, you will also need to install the **dpkg** and **fakeroot** packages:
   ```shell
   sudo apt install dpkg fakeroot
   ```

2. Ensure the `node`, `npm`, and `git` commands are recognized in the terminal. Restart your system if necessary.

3. Open the terminal in the folder where you want to clone the repository and run the following commands:

   ```shell
   git clone https://github.com/tettov/tanki-tweaks-client
   ```
   ```shell
   cd tanki-tweaks-client
   ```
   ```shell
   npm ci && npm run make
   ```

Once the build is complete, the installation file will be available in the `tanki-tweaks-client -> out -> make` folder.

## 🧩 Custom Extensions

The client uses the **Electron** framework, which supports a limited set of APIs for extensions. Detailed information is available in the [official documentation](https://www.electronjs.org/docs/latest/api/extensions#supported-extensions-apis).

Although not all extensions are supported, you can use ones specifically developed for the game. To add an unpacked extension, place its folder (containing the `manifest.json` file) in the following location:

**Windows:**
```
C:\Users\<username>\AppData\Roaming\Tanki Online with Tweaks\extensions
```
> 💡 To quickly access the extensions folder, type the following in File Explorer's address bar: `%APPDATA%\Tanki Online with Tweaks\extensions`

**macOS:**
```
/Users/<username>/Library/Application Support/Tanki Online with Tweaks/extensions
```

# [RU] Tanki Tweaks Client

**Альтернативный клиент для игры «Танки Онлайн».**

> [🌐 **Discord**](https://discord.gg/hJn2QeJsT3) • [🌐 **Telegram**](https://t.me/tanki_projects) • [❤️ **Boosty**](https://boosty.to/tanki-projects)

## 📥 Загрузки

> ⚠️ На macOS перед подключением dmg с приложением необходимо очистить его атрибуты с помощью команды в Терминале:
>
> ```
> xattr -c <путь к dmg>
> ```

| ОС          | Архитектура           | Ссылка     |
|-------------|-----------------------|------------|
| **Windows** | x64 *(Intel, AMD)*    | [Download](https://github.com/tettov/tanki-tweaks-client/releases/download/1.1.2/to-1.1.2-win32-x64.exe) |
| **macOS**   | ARM *(Apple silicon)* | [Download](https://github.com/tettov/tanki-tweaks-client/releases/download/1.1.2/to-1.1.2-darwin-arm64.dmg) |
| **macOS**   | x64 *(Intel)*         | [Download](https://github.com/tettov/tanki-tweaks-client/releases/download/1.1.2/to-1.1.2-darwin-x64.dmg) |

> ℹ️ У приложения нет цифровой подписи, и операционная система может предупредить о потенциальных рисках. Для продолжения установки и запуска следуйте инструкциям для вашей ОС.

## ✨ Ключевые особенности

- Все возможности [**Tanki Tweaks**](https://chromewebstore.google.com/detail/tanki-tweaks/khcoecipddmigggaeokhmhmhjhlpcpnb) — расширения для браузера.

- Актуальная версия браузерного движка с улучшенной производительностью и исправлениями ошибок.

- Поддержка пользовательских расширений.

- Совместимость с Windows 10 и 11, macOS, и Debian/Ubuntu.

## 🛠️ Сборка из исходников

1. Установите [**Node.js**](https://nodejs.org) и [**Git**](https://git-scm.com). При установке оставляйте параметры по умолчанию, если не уверены.
   
   В Debian/Ubuntu также потребуется установить пакеты **dpkg** и **fakeroot**:
   ```shell
   sudo apt install dpkg fakeroot
   ```

2. Убедитесь, что терминал распознаёт команды `node`, `npm` и `git`. При необходимости перезагрузите систему.

3. Откройте терминал в папке, где будет располагаться репозиторий с исходным кодом, и выполните следующие команды:

   ```shell
   git clone https://github.com/tettov/tanki-tweaks-client
   ```
   ```shell
   cd tanki-tweaks-client
   ```
   ```shell
   npm ci && npm run make
   ```

После успешной сборки в папке `tanki-tweaks-client -> out -> make` появится установочный файл.

## 🧩 Пользовательские расширения

Клиент использует фреймворк **Electron**, который поддерживает ограниченный набор API для расширений. Подробную информацию можно найти в [официальной документации](https://www.electronjs.org/docs/latest/api/extensions#supported-extensions-apis).

Хотя не все расширения будут работать, вы можете использовать специально разработанные для игры расширения. Для этого разместите распакованное расширение (папку с файлом `manifest.json`) по следующему пути:

**Windows:**
```
C:\Users\<имя пользователя>\AppData\Roaming\Tanki Online with Tweaks\extensions
```
> 💡 Для быстрого доступа к папке с расширениями введите путь в адресной строке Проводника: `%APPDATA%\Tanki Online with Tweaks\extensions`

**macOS:**
```
/Users/<имя пользователя>/Library/Application Support/Tanki Online with Tweaks/extensions
```
