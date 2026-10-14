#!/usr/bin/env python3
"""Собирает APK счётчика дней для Android без Gradle и Android Studio.

Нужны пакеты Ubuntu: aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange
и JDK. Запуск: python3 android/build_apk.py → android/dni.apk

Страница — тот же counter/schetchik.html; шрифты зашиваются внутрь, чтобы
приложение выглядело одинаково и без интернета.
"""
import base64, pathlib, re, shutil, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).parent
REPO = ROOT.parent
sys.path.insert(0, str(REPO / 'counter'))
from build_app import icon  # noqa: E402

ANDROID_JAR = '/usr/lib/android-sdk/platforms/android-23/android.jar'
KEYSTORE = ROOT / 'dni.keystore'
KEY_PASS = 'dni-counter'  # ключ только для этого личного приложения
BUILD = ROOT / 'build'
OUT = ROOT / 'dni.apk'
FONTS_CSS = ('https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700'
             '&family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap')
UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'


def run(*cmd):
    subprocess.run([str(c) for c in cmd], check=True)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return urllib.request.urlopen(req, timeout=30).read()


def inline_fonts():
    """CSS Google Fonts с woff2 внутри (только кириллица и латиница)."""
    css = fetch(FONTS_CSS).decode()
    blocks = re.findall(r'/\* ([\w-]+) \*/\s*(@font-face \{.*?\})', css, re.S)
    out = []
    for subset, block in blocks:
        if subset not in ('cyrillic', 'latin'):
            continue
        url = re.search(r'url\((https://[^)]+)\)', block).group(1)
        data = base64.b64encode(fetch(url)).decode()
        out.append(block.replace(url, 'data:font/woff2;base64,' + data))
    return '\n'.join(out)


def page():
    body = (REPO / 'counter/schetchik.html').read_text(encoding='utf-8')
    body = re.sub(r'<link rel="(preconnect|stylesheet)"[^>]*>\n', '', body)
    body = body.replace('Данные хранятся только в этом браузере.', 'Данные хранятся только на этом телефоне.')
    head_end = body.index('<div class="wrap">')
    return ('<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            '<style>\n' + inline_fonts() + '\nbody { margin: 0; -webkit-tap-highlight-color: transparent; }\n'
            '[hidden] { display: none !important; }\n</style>\n'
            + body[:head_end] + '</head>\n<body>\n' + body[head_end:] + '\n</body>\n</html>\n')


def icons(res):
    for name, px in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
        d = res / ('mipmap-' + name)
        d.mkdir(parents=True, exist_ok=True)
        icon(px).save(d / 'ic_launcher.png')
        # слой адаптивного значка: 108dp, видимая часть — центральные 72dp
        icon(px * 108 // 48, k=0.44).save(d / 'ic_launcher_fg.png')


def main():
    shutil.rmtree(BUILD, ignore_errors=True)
    res, assets, classes = BUILD / 'res', BUILD / 'assets', BUILD / 'classes'
    shutil.copytree(ROOT / 'res', res)
    icons(res)
    assets.mkdir(parents=True)
    (assets / 'index.html').write_text(page(), encoding='utf-8')
    classes.mkdir()
    gen = BUILD / 'gen'
    gen.mkdir()

    run('aapt', 'package', '-f', '-m', '-J', gen, '-M', ROOT / 'AndroidManifest.xml',
        '-S', res, '-I', ANDROID_JAR)
    srcs = list((ROOT / 'src').rglob('*.java')) + list(gen.rglob('*.java'))
    run('javac', '-nowarn', '-source', '8', '-target', '8', '-bootclasspath', ANDROID_JAR,
        '-d', classes, *srcs)
    run('dalvik-exchange', '--dex', '--output=' + str(BUILD / 'classes.dex'), classes)

    unsigned = BUILD / 'unsigned.apk'
    run('aapt', 'package', '-f', '-M', ROOT / 'AndroidManifest.xml', '-S', res, '-A', assets,
        '-I', ANDROID_JAR, '-F', unsigned)
    subprocess.run(['aapt', 'add', unsigned.name, 'classes.dex'], cwd=BUILD, check=True)
    aligned = BUILD / 'aligned.apk'
    run('zipalign', '-f', '4', unsigned, aligned)

    if not KEYSTORE.exists():
        run('keytool', '-genkeypair', '-keystore', KEYSTORE, '-alias', 'dni', '-keyalg', 'RSA',
            '-keysize', '2048', '-validity', '10000', '-storepass', KEY_PASS, '-keypass', KEY_PASS,
            '-dname', 'CN=Dni counter')
    run('apksigner', 'sign', '--ks', KEYSTORE, '--ks-key-alias', 'dni', '--ks-pass', 'pass:' + KEY_PASS,
        '--key-pass', 'pass:' + KEY_PASS, '--min-sdk-version', '23', '--out', OUT, aligned)
    run('apksigner', 'verify', OUT)
    print('%s — %.0f КБ' % (OUT, OUT.stat().st_size / 1024))


if __name__ == '__main__':
    main()
