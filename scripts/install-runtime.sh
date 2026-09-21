set -eu
test "$(systemctl is-active zuyu)" = active
curl -fsS --max-time 10 http://127.0.0.1:8787/ready >/dev/null
test "$(uname -m)" = x86_64
base=/opt/za-spa-saas
install -d -m 755 "$base/runtime" "$base/releases"
if ! test -x "$base/runtime/node-v24.19.0-linux-x64/bin/node"; then
 cd "$base/runtime"
 curl --fail --location --proto '=https' --tlsv1.2 --max-time 180 -o node-v24.19.0-linux-x64.tar.xz https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz
 curl --fail --location --proto '=https' --tlsv1.2 --max-time 30 -o SHASUMS256.txt https://nodejs.org/dist/v24.19.0/SHASUMS256.txt
 grep ' node-v24.19.0-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c -
 tar -xJf node-v24.19.0-linux-x64.tar.xz
fi
"$base/runtime/node-v24.19.0-linux-x64/bin/node" --version
if ! id za-spa-saas >/dev/null 2>&1; then useradd --system --home-dir "$base" --shell /usr/sbin/nologin za-spa-saas; fi
curl -fsS --max-time 10 http://127.0.0.1:8787/ready
