# SwiftPayme Git Workflow

## Repository Structure

The SwiftPayme repository follows a structured Git workflow with multiple branches for different environments and development stages.

## Branch Structure

### Main Branches

- **`master`** - Production-ready code
  - Contains stable, tested code ready for production deployment
  - All commits should be tagged with version numbers
  - Direct commits are not allowed; only merges from staging

- **`staging`** - Pre-production testing
  - Integration testing environment
  - Code that has passed development testing
  - Final testing before production deployment

- **`develop`** - Development integration
  - Integration branch for new features
  - Continuous integration and testing
  - Base branch for feature development

### Feature Branches

Create feature branches from `develop` for new features:

```bash
git checkout develop
git checkout -b feature/payment-gateway-enhancement
# Develop your feature
git checkout develop
git merge feature/payment-gateway-enhancement
```

### Hotfix Branches

For critical production fixes:

```bash
git checkout master
git checkout -b hotfix/security-patch-v1.0.1
# Fix the issue
git checkout master
git merge hotfix/security-patch-v1.0.1
git tag v1.0.1
```

## Workflow Process

### 1. Feature Development
```bash
# Start new feature
git checkout develop
git pull origin develop
git checkout -b feature/new-feature

# Develop and commit
git add .
git commit -m "feat: implement new feature"

# Push and create PR
git push origin feature/new-feature
```

### 2. Code Review & Integration
```bash
# After PR approval, merge to develop
git checkout develop
git merge feature/new-feature
git push origin develop
```

### 3. Staging Deployment
```bash
# Deploy to staging for testing
git checkout staging
git merge develop
git push origin staging
```

### 4. Production Release
```bash
# After staging approval
git checkout master
git merge staging
git tag v1.1.0
git push origin master --tags
```

## Commit Message Convention

Follow conventional commit format:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions or modifications
- `chore:` - Build process or auxiliary tool changes

### Examples
```
feat: add multi-currency support to transaction service
fix: resolve memory leak in API gateway
docs: update deployment guide with Kubernetes instructions
refactor: optimize database connection pooling
test: add integration tests for billing service
chore: update Docker base images to latest versions
```

## Version Tagging

Use semantic versioning (SemVer):

- **Major** (v2.0.0) - Breaking changes
- **Minor** (v1.1.0) - New features, backward compatible
- **Patch** (v1.0.1) - Bug fixes, backward compatible

```bash
# Create annotated tag
git tag -a v1.1.0 -m "Release v1.1.0: Add cryptocurrency support"
git push origin --tags
```

## Release Process

### 1. Prepare Release
- Ensure all features are merged to develop
- Update version numbers in package.json files
- Update CHANGELOG.md
- Run full test suite

### 2. Staging Validation
- Deploy to staging environment
- Run integration tests
- Perform user acceptance testing
- Security and performance validation

### 3. Production Deployment
- Merge staging to master
- Create release tag
- Deploy to production
- Monitor system health

### 4. Post-Release
- Update documentation
- Communicate release notes
- Monitor for issues
- Plan next iteration

## Git Hooks

### Pre-commit Hooks
- Code formatting (Prettier)
- Linting (ESLint)
- Type checking (TypeScript)
- Unit tests

### Pre-push Hooks
- Integration tests
- Security scanning
- Dependency vulnerability check

## Repository Maintenance

### Regular Tasks
- Clean up merged feature branches
- Update dependencies
- Security patches
- Performance optimizations

### Branch Cleanup
```bash
# Delete merged feature branches
git branch --merged | grep -v "\*\|master\|develop\|staging" | xargs -n 1 git branch -d

# Delete remote tracking branches
git remote prune origin
```

## Collaboration Guidelines

### Pull Request Process
1. Create feature branch from develop
2. Implement feature with tests
3. Create pull request with description
4. Code review by team members
5. Address review comments
6. Merge after approval

### Code Review Checklist
- [ ] Code follows style guidelines
- [ ] Tests are included and passing
- [ ] Documentation is updated
- [ ] Security considerations addressed
- [ ] Performance impact assessed
- [ ] Breaking changes documented

## Emergency Procedures

### Critical Hotfixes
1. Create hotfix branch from master
2. Implement minimal fix
3. Test thoroughly
4. Deploy to staging for validation
5. Merge to master and tag
6. Deploy to production immediately
7. Merge back to develop and staging

### Rollback Procedure
```bash
# Rollback to previous version
git checkout master
git reset --hard v1.0.0
git push origin master --force-with-lease

# Or create revert commit
git revert <commit-hash>
git push origin master
```

## Tools Integration

### CI/CD Pipeline
- Automated testing on all branches
- Deployment to staging on develop merge
- Production deployment on master tag

### Monitoring
- Git activity monitoring
- Code quality metrics
- Security vulnerability scanning

---

**Note**: This workflow ensures code quality, security, and reliable deployments for the SwiftPayme financial platform.

