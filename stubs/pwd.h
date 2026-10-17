// pwd.h (stub)

#ifndef _PWD_H
#define _PWD_H

#include <sys/types.h> 

struct passwd {
    uid_t pw_uid;
    gid_t pw_gid; 
    char *pw_name;
    char *pw_dir;
    char *pw_shell;
};

static inline struct passwd *getpwnam(const char *name) {
    return NULL; 
}

static inline struct passwd *getpwuid(uid_t uid) {
    return NULL; 
}

#endif // _PWD_H
