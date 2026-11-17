pub mod branches;
pub mod changes;
pub mod history;
pub mod remote;
pub mod repo;
pub mod terminal;

use crate::git::GitOutput;
use crate::models::GitOpResult;

pub fn op_result(output: GitOutput) -> GitOpResult {
    GitOpResult {
        stdout: output.stdout,
        stderr: output.stderr,
    }
}
