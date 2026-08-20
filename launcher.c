#include <libgen.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int file_exists(const char *path) {
    struct stat info;
    return stat(path, &info) == 0 && S_ISREG(info.st_mode);
}

static void launch_python(const char *launcher_path) {
    const char *python_candidates[] = {
        "/usr/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        NULL,
    };
    for (int index = 0; python_candidates[index] != NULL; index++) {
        if (!file_exists(python_candidates[index])) continue;
        execl(python_candidates[index], "python3", launcher_path, (char *)NULL);
    }
    execl("/usr/bin/env", "env", "python3", launcher_path, (char *)NULL);
}

int main(void) {
    char executable_path[PATH_MAX];
    uint32_t path_size = sizeof(executable_path);
    if (_NSGetExecutablePath(executable_path, &path_size) != 0) {
        fprintf(stderr, "Unable to resolve launcher path.\n");
        return 1;
    }

    char resolved_path[PATH_MAX];
    if (realpath(executable_path, resolved_path) == NULL) {
        perror("realpath");
        return 1;
    }

    char launcher_path[PATH_MAX];
    char candidate_directory[PATH_MAX];
    strlcpy(candidate_directory, resolved_path, sizeof(candidate_directory));

    // The app may be moved or nested differently. Search upward for the
    // project launcher instead of relying on a fixed .app directory depth.
    for (int depth = 0; depth < 10; depth++) {
        char scratch_path[PATH_MAX];
        strlcpy(scratch_path, candidate_directory, sizeof(scratch_path));
        char *directory = dirname(scratch_path);
        if (directory == NULL || directory[0] == '\0') break;
        strlcpy(candidate_directory, directory, sizeof(candidate_directory));

        int length = snprintf(launcher_path, sizeof(launcher_path), "%s/launcher.py", candidate_directory);
        if (length < 0 || length >= (int)sizeof(launcher_path)) {
            fprintf(stderr, "Launcher path is too long.\n");
            return 1;
        }
        if (file_exists(launcher_path)) {
            launch_python(launcher_path);
            perror("python3");
            return 1;
        }
    }

    fprintf(stderr, "Unable to locate launcher.py near app executable.\n");
    return 1;
}
