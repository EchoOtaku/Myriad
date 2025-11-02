# Contributing to Myriad

Thank you for your interest in contributing to Myriad! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in Issues
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - System information (OS, Rust version, Node version)
   - Screenshots if applicable

### Suggesting Features

1. Check if the feature has been suggested in Issues
2. Create a new issue with:
   - Clear description of the feature
   - Use cases and benefits
   - Possible implementation approach

### Pull Requests

1. **Fork the repository**
   ```bash
   git clone https://github.com/yourusername/Myriad.git
   cd Myriad
   git remote add upstream https://github.com/originalowner/Myriad.git
   ```

2. **Create a branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

3. **Make your changes**
   - Follow the coding style (see below)
   - Write tests for new features
   - Update documentation as needed
   - Keep commits focused and atomic

4. **Test your changes**
   ```powershell
   # Backend tests
   cd backend
   cargo test
   cargo clippy
   cargo fmt --check
   
   # Frontend tests
   cd frontend
   npm run build
   npm run format
   ```

5. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   # or
   git commit -m "fix: resolve issue #123"
   ```

   Use conventional commit format:
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `style:` Code style changes (formatting)
   - `refactor:` Code refactoring
   - `test:` Adding tests
   - `chore:` Maintenance tasks

6. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

7. **Open a Pull Request**
   - Go to the original repository
   - Click "New Pull Request"
   - Select your branch
   - Fill in the PR template
   - Link related issues

## Coding Style

### Rust (Backend)

- Follow [Rust API Guidelines](https://rust-lang.github.io/api-guidelines/)
- Use `cargo fmt` for formatting
- Use `cargo clippy` for linting
- Write documentation comments for public APIs
- Keep functions focused and small

Example:
```rust
/// Fetches user profile from GitHub API
///
/// # Arguments
///
/// * `username` - The GitHub username
///
/// # Returns
///
/// Returns the user profile data or an error
pub async fn fetch_github_profile(username: &str) -> Result<Profile, Error> {
    // implementation
}
```

### TypeScript/JavaScript (Frontend)

- Follow Prettier configuration
- Use meaningful variable names
- Prefer functional components in React
- Use TypeScript types, avoid `any`

Example:
```typescript
interface UserProfile {
  id: number;
  username: string;
  displayName: string;
}

export const fetchProfile = async (id: number): Promise<UserProfile> => {
  // implementation
};
```

### Astro Components

- Use descriptive component names
- Props should be typed
- Keep components focused

Example:
```astro
---
interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Default description' } = Astro.props;
---

<div class="component">
  <h2>{title}</h2>
  {description && <p>{description}</p>}
</div>
```

## Project Structure

- `backend/src/api/` - API route handlers
- `backend/src/services/` - Business logic
- `backend/src/models/` - Data models
- `frontend/src/pages/` - Route pages
- `frontend/src/components/` - Reusable components
- `docs/` - Documentation

## Testing

### Backend

```powershell
cd backend

# Run all tests
cargo test

# Run specific test
cargo test test_name

# Run with output
cargo test -- --nocapture
```

### Frontend

```powershell
cd frontend

# Type check
npm run astro check

# Build test
npm run build
```

## Documentation

- Update README.md for major changes
- Update API.md for API changes
- Add JSDoc/rustdoc comments
- Update CHANGELOG.md

## License

By contributing, you agree that your contributions will be licensed under the GNU General Public License v3.0.

## Questions?

- Open an issue for questions
- Check existing documentation
- Review closed issues and PRs

Thank you for contributing! 🎉
