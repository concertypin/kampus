Structure:

tests/

- tests/unit/ : Contains unit tests that run in a Node.js environment using Vitest. These tests focus on individual functions and modules without browser dependencies. Should be fast and isolated.

- tests/fixtures/ : HTML fixtures shared by the unit tests, one subdirectory per area (`activities/`, `attendance/`, `notices/`, `quiz/`). Keep all fixtures here, not next to the test files.

Each subdirectory should follow same structure as src/ for easy mapping between source files and tests.
