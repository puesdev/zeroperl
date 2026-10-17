#ifndef ZEROPERL_SIGNAL_H
#define ZEROPERL_SIGNAL_H

#include_next <signal.h>

// wasi-libc hides sigaction and signal sets; only signal() and raise() exist
// (wasi-emulated-signal). POSIX.xs needs the rest, so emulate it on signal().
// Signals are never delivered asynchronously, so the mask has no effect.
#ifndef SIG_BLOCK
#include <errno.h>
#include <string.h>

#define SIG_BLOCK 0
#define SIG_UNBLOCK 1
#define SIG_SETMASK 2

struct sigaction {
  void (*sa_handler)(int);
  sigset_t sa_mask;
  int sa_flags;
};

#define ZEROPERL_SIGSET_BITS ((int)(sizeof(sigset_t) * 8))

static inline int sigemptyset(sigset_t *set) {
  memset(set, 0, sizeof(*set));
  return 0;
}

static inline int sigfillset(sigset_t *set) {
  memset(set, 0xff, sizeof(*set));
  return 0;
}

static inline int zeroperl_sigbit(int sig) {
  if (sig < 1 || sig > ZEROPERL_SIGSET_BITS) {
    errno = EINVAL;
    return -1;
  }
  return sig - 1;
}

static inline int sigaddset(sigset_t *set, int sig) {
  int bit = zeroperl_sigbit(sig);
  if (bit < 0)
    return -1;
  ((unsigned char *)set)[bit / 8] |= (unsigned char)(1u << (bit % 8));
  return 0;
}

static inline int sigdelset(sigset_t *set, int sig) {
  int bit = zeroperl_sigbit(sig);
  if (bit < 0)
    return -1;
  ((unsigned char *)set)[bit / 8] &= (unsigned char)~(1u << (bit % 8));
  return 0;
}

static inline int sigismember(const sigset_t *set, int sig) {
  int bit = zeroperl_sigbit(sig);
  if (bit < 0)
    return -1;
  return (((const unsigned char *)set)[bit / 8] >> (bit % 8)) & 1;
}

static inline int sigprocmask(int how, const sigset_t *set, sigset_t *oset) {
  (void)how;
  (void)set;
  if (oset)
    sigemptyset(oset);
  return 0;
}

static inline int sigpending(sigset_t *set) { return sigemptyset(set); }

static inline int sigsuspend(const sigset_t *mask) {
  (void)mask;
  errno = ENOSYS;
  return -1;
}

static inline int sigaction(int sig, const struct sigaction *act,
                            struct sigaction *oact) {
  void (*old)(int);
  if (act) {
    old = signal(sig, act->sa_handler);
  } else {
    old = signal(sig, SIG_DFL);
    if (old != SIG_ERR)
      signal(sig, old);
  }
  if (old == SIG_ERR)
    return -1;
  if (oact) {
    memset(oact, 0, sizeof(*oact));
    oact->sa_handler = old;
  }
  return 0;
}
#endif // SIG_BLOCK

#endif // ZEROPERL_SIGNAL_H
