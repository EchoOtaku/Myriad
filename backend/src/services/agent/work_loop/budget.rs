//! Durable task spend. Reservations survive an interrupted provider request.
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Budget {
    pub spent_tokens: u64,
    pub reserved_tokens: u64,
    pub limit_tokens: u64,
}

impl Default for Budget {
    fn default() -> Self {
        Self {
            spent_tokens: 0,
            reserved_tokens: 0,
            limit_tokens: 128_000,
        }
    }
}

impl Budget {
    pub fn remaining(&self) -> u64 {
        self.limit_tokens
            .saturating_sub(self.spent_tokens.saturating_add(self.reserved_tokens))
    }

    pub fn settle(&mut self, actual: Option<u64>) {
        self.spent_tokens = self
            .spent_tokens
            .saturating_add(actual.unwrap_or(self.reserved_tokens));
        self.reserved_tokens = 0;
    }

    pub fn reserve_model(&mut self, input_estimate: u64) -> Result<u32, String> {
        let output = self.remaining().saturating_sub(input_estimate).min(8192);
        if output == 0 {
            return Err("The task reached its token budget".into());
        }
        self.reserved_tokens = input_estimate.saturating_add(output);
        Ok(output as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reservation_survives_restart_and_limits_output() {
        let mut budget = Budget {
            limit_tokens: 100,
            ..Default::default()
        };
        assert_eq!(budget.reserve_model(60).unwrap(), 40);
        let mut restored: Budget =
            serde_json::from_value(serde_json::to_value(budget).unwrap()).unwrap();
        restored.settle(None);
        assert_eq!(restored.spent_tokens, 100);
        assert!(restored.reserve_model(1).is_err());
    }
}
