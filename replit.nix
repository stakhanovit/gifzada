{ pkgs }: {
  deps = [
    pkgs.nodejs_18  # ou nodejs_20, se você estiver usando essa versão
    pkgs.pkg-config
    pkgs.cairo
    pkgs.pango
    pkgs.libjpeg
    pkgs.gtk3
    pkgs.glib
    pkgs.libuuid
  ];
}
