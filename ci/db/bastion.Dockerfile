# A bastion whose only job is to forward TCP.
#
# Built here rather than pulled: the obvious off-the-shelf image ships
# `AllowTcpForwarding no`, which is a sensible default for a general SSH
# server and exactly wrong for this one. The setting that matters is the whole
# point of the container, so it is stated here instead of inherited.
FROM alpine:3.21

RUN apk add --no-cache openssh-server \
 && ssh-keygen -A \
 && adduser -D -s /sbin/nologin smoke \
 # `adduser -D` leaves the account password-locked, and sshd refuses a locked
 # account even when the key is right ("account is locked"). `*` means "no
 # password will ever match" without marking the account disabled.
 && sed -i 's/^smoke:!:/smoke:*:/' /etc/shadow \
 && mkdir -p /home/smoke/.ssh \
 && chown -R smoke:smoke /home/smoke/.ssh \
 && chmod 700 /home/smoke/.ssh

# Key-only, forwarding-only. `-N` sessions need no shell, which is why the
# account has none.
RUN printf '%s\n' \
      'PermitRootLogin no' \
      'PasswordAuthentication no' \
      'PubkeyAuthentication yes' \
      'AllowTcpForwarding yes' \
      'PermitOpen any' \
      'AllowAgentForwarding no' \
      'X11Forwarding no' \
      'PermitTTY no' \
      'LogLevel VERBOSE' \
    > /etc/ssh/sshd_config.d/10-bastion.conf

# The client's public key is copied in at start, not bind-mounted onto
# authorized_keys. A mounted file keeps the host's ownership, and sshd refuses
# an authorized_keys it does not consider the user's own -- which would make
# this depend on whichever uid the CI runner happens to use.
RUN printf '%s\n' \
      '#!/bin/sh' \
      'set -eu' \
      'if [ -n "${PUBLIC_KEY:-}" ]; then' \
      '  printf "%s\\n" "$PUBLIC_KEY" > /home/smoke/.ssh/authorized_keys' \
      'elif [ -f /run/bastion/authorized_key.pub ]; then' \
      '  cat /run/bastion/authorized_key.pub > /home/smoke/.ssh/authorized_keys' \
      'else' \
      '  echo "set PUBLIC_KEY or mount /run/bastion/authorized_key.pub" >&2; exit 1' \
      'fi' \
      'chown smoke:smoke /home/smoke/.ssh/authorized_keys' \
      'chmod 600 /home/smoke/.ssh/authorized_keys' \
      'exec /usr/sbin/sshd -D -e' \
    > /usr/local/bin/entrypoint.sh \
 && chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
