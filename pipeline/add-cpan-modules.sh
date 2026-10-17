#!/bin/sh
set -e

# Pure-Perl CPAN modules added to the embedded library, at pinned releases.

PERL_VERSION="${PERL_VERSION:-5.42.0}"
DEST="/zeroperl/lib/$PERL_VERSION"
WORK="${CPAN_WORK:-/build/cpan}"
CPAN="https://cpan.metacpan.org/authors/id"

mkdir -p "$WORK"

# add AUTHOR/PATH/Dist-Version.tar.gz [files under lib/ to copy; default all]
add() {
    tarball="$1"
    shift
    name=$(basename "$tarball" .tar.gz)
    curl -fsSL "$CPAN/$tarball" -o "$WORK/$name.tar.gz"
    tar -xzf "$WORK/$name.tar.gz" -C "$WORK"
    if [ "$#" -eq 0 ]; then
        cp -R "$WORK/$name/lib/." "$DEST/"
        return
    fi
    for file in "$@"; do
        mkdir -p "$DEST/$(dirname "$file")"
        cp "$WORK/$name/lib/$file" "$DEST/$file"
    done
}

add I/IS/ISHIGAKI/Text-CSV-2.06.tar.gz
add E/ET/ETHER/YAML-Tiny-1.76.tar.gz
add D/DC/DCANTRELL/XML-Tiny-2.07.tar.gz
add O/OA/OALDERS/URI-5.37.tar.gz URI/Escape.pm
add R/RJ/RJBS/Algorithm-Diff-1.201.tar.gz
add N/NE/NEILB/Text-Diff-1.46.tar.gz
add D/DB/DBOOK/CGI-Tiny-1.003.tar.gz
