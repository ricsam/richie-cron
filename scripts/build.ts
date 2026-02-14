import path from 'node:path';
import { existsSync } from 'node:fs';
import { $, Glob } from 'bun';

const __dirname = import.meta.dirname;
const packageDir = path.join(__dirname, '..');
const packageJsonPath = path.join(packageDir, 'package.json');

type PackageJson = Record<string, unknown> & {
  name: string;
  version: string;
};

const TS_EXTENSION_PATTERN = /\.tsx?$/;
const ANY_EXTENSION_PATTERN = /\.[^/]+$/;

const resolveRelativeSpecifier = (importerPath: string, rawSpecifier: string, extension: 'cjs' | 'mjs'): string => {
  if (!rawSpecifier.startsWith('.')) {
    return rawSpecifier;
  }

  if (TS_EXTENSION_PATTERN.test(rawSpecifier)) {
    return rawSpecifier.replace(TS_EXTENSION_PATTERN, `.${extension}`);
  }

  if (rawSpecifier.endsWith(`.${extension}`) || ANY_EXTENSION_PATTERN.test(rawSpecifier)) {
    return rawSpecifier;
  }

  const importerDir = path.dirname(importerPath);
  const absoluteBase = path.resolve(importerDir, rawSpecifier);

  if (existsSync(`${absoluteBase}.ts`) || existsSync(`${absoluteBase}.tsx`)) {
    return `${rawSpecifier}.${extension}`;
  }

  if (existsSync(path.join(absoluteBase, 'index.ts')) || existsSync(path.join(absoluteBase, 'index.tsx'))) {
    return `${rawSpecifier.replace(/\/$/, '')}/index.${extension}`;
  }

  return `${rawSpecifier}.${extension}`;
};

const createBuildTsconfigs = async () => {
  await Bun.write(
    path.join(packageDir, 'tsconfig.build.json'),
    JSON.stringify(
      {
        compilerOptions: {
          allowJs: true,
          allowSyntheticDefaultImports: true,
          allowImportingTsExtensions: true,
          target: 'ESNext',
          declaration: true,
          esModuleInterop: true,
          inlineSourceMap: false,
          lib: ['ESNext'],
          listEmittedFiles: false,
          listFiles: false,
          moduleResolution: 'bundler',
          noFallthroughCasesInSwitch: true,
          pretty: true,
          resolveJsonModule: true,
          rootDir: '.',
          skipLibCheck: true,
          strict: true,
          traceResolution: false,
        },
        compileOnSave: false,
        exclude: ['node_modules', 'dist', '**/*.test.ts', 'tests/**/*'],
        include: ['index.ts', 'src/**/*.ts'],
      },
      null,
      2,
    ),
  );

  await Bun.write(
    path.join(packageDir, 'tsconfig.types.json'),
    JSON.stringify(
      {
        extends: './tsconfig.build.json',
        compilerOptions: {
          declaration: true,
          outDir: 'dist/types',
          emitDeclarationOnly: true,
          declarationDir: 'dist/types',
        },
      },
      null,
      2,
    ),
  );
};

const cleanupBuildTsconfigs = async () => {
  await $`rm -f tsconfig.build.json tsconfig.types.json`.cwd(packageDir).nothrow();
};

const runTsc = async (tsconfig: string): Promise<boolean> => {
  const { stdout, stderr, exitCode } = await $`bunx --bun tsc -p ${tsconfig}`
    .cwd(packageDir)
    .nothrow();

  if (exitCode !== 0) {
    console.error(stderr.toString());
    console.log(stdout.toString());
    return false;
  }

  const output = stdout.toString();
  if (output.trim() !== '') {
    console.log(output);
  }

  console.log('  ✅ Type declarations generated');
  return true;
};

const buildSourceFile = async (src: string, relativeDir: string, target: 'cjs' | 'mjs'): Promise<boolean> => {
  const result = await Bun.build({
    entrypoints: [src],
    outdir: path.join(packageDir, 'dist', target, relativeDir),
    sourcemap: 'external',
    format: target === 'mjs' ? 'esm' : 'cjs',
    packages: 'external',
    external: ['*'],
    naming: `[name].${target}`,
    target: 'node',
    plugins: [
      {
        name: 'extension-plugin',
        setup(build) {
          build.onLoad({ filter: /\.tsx?$/, namespace: 'file' }, async (args) => {
            let content = await Bun.file(args.path).text();
            const extension = target;

            content = content.replace(/(from\s*['"])(\.{1,2}\/[^'"]+)(['"])/gm, (_match, prefix, specifier, suffix) => {
              const resolvedSpecifier = resolveRelativeSpecifier(args.path, specifier, extension);
              return `${prefix}${resolvedSpecifier}${suffix}`;
            });

            content = content.replace(
              /(import\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/gm,
              (_match, prefix, specifier, suffix) => {
                const resolvedSpecifier = resolveRelativeSpecifier(args.path, specifier, extension);
                return `${prefix}${resolvedSpecifier}${suffix}`;
              },
            );

            return {
              contents: content,
              loader: args.path.endsWith('.tsx') ? 'tsx' : 'ts',
            };
          });
        },
      },
    ],
  });

  result.logs.forEach((log) => {
    console.log(`  [${log.level}] ${log.message}`);
  });

  return result.success;
};

const buildRootIndex = async (target: 'cjs' | 'mjs'): Promise<boolean> => {
  return buildSourceFile(path.join(packageDir, 'index.ts'), '', target);
};

const buildSrcTree = async (target: 'cjs' | 'mjs'): Promise<boolean> => {
  const tsGlob = new Glob('**/*.ts');
  let allSuccess = true;

  for await (const file of tsGlob.scan({
    cwd: path.join(packageDir, 'src'),
  })) {
    if (file.endsWith('.test.ts') || file.endsWith('.d.ts')) {
      continue;
    }

    const relativeDir = path.dirname(file);
    const success = await buildSourceFile(path.join(packageDir, 'src', file), path.join('src', relativeDir), target);
    if (!success) {
      allSuccess = false;
    }
  }

  return allSuccess;
};

const rewriteCjsRelativeSpecifiers = async () => {
  const cjsDir = path.join(packageDir, 'dist', 'cjs');
  const cjsGlob = new Glob('**/*.cjs');

  for await (const file of cjsGlob.scan({ cwd: cjsDir })) {
    const filePath = path.join(cjsDir, file);
    const originalContent = await Bun.file(filePath).text();
    let content = originalContent;

    content = content.replace(
      /(require\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/gm,
      (_match, prefix, specifier, suffix) => {
        if (ANY_EXTENSION_PATTERN.test(specifier)) {
          return `${prefix}${specifier}${suffix}`;
        }

        return `${prefix}${specifier}.cjs${suffix}`;
      },
    );

    content = content.replace(
      /(import\(\s*['"])(\.{1,2}\/[^'"]+)(['"]\s*\))/gm,
      (_match, prefix, specifier, suffix) => {
        if (ANY_EXTENSION_PATTERN.test(specifier)) {
          return `${prefix}${specifier}${suffix}`;
        }

        return `${prefix}${specifier}.cjs${suffix}`;
      },
    );

    if (content !== originalContent) {
      await Bun.write(filePath, content);
    }
  }
};

const writeSubPackageJson = async (packageJson: PackageJson, folder: string, type: 'commonjs' | 'module') => {
  await Bun.write(
    path.join(packageDir, folder, 'package.json'),
    JSON.stringify(
      {
        name: packageJson.name,
        version: packageJson.version,
        type,
      },
      null,
      2,
    ),
  );
};

const writePublishPackageJson = async (packageJson: PackageJson) => {
  const publishPackageJson: PackageJson = { ...packageJson };

  delete publishPackageJson.devDependencies;
  publishPackageJson.main = './dist/cjs/index.cjs';
  publishPackageJson.module = './dist/mjs/index.mjs';
  publishPackageJson.types = './dist/types/index.d.ts';
  publishPackageJson.exports = {
    '.': {
      types: './dist/types/index.d.ts',
      require: './dist/cjs/index.cjs',
      import: './dist/mjs/index.mjs',
    },
  };
  publishPackageJson.publishConfig = {
    access: 'public',
  };
  publishPackageJson.files = ['dist', 'README.md'];

  await Bun.write(packageJsonPath, JSON.stringify(publishPackageJson, null, 2));
};

const main = async () => {
  const packageJson = (await Bun.file(packageJsonPath).json()) as PackageJson;

  try {
    console.log('🚀 Building package for npm publishing...');
    console.log('============================================================\n');
    console.log(`\n📦 Building ${packageJson.name}...`);

    await createBuildTsconfigs();
    await $`rm -rf dist`.cwd(packageDir).nothrow();

    const success = (
      await Promise.all([
        buildRootIndex('mjs'),
        buildRootIndex('cjs'),
        buildSrcTree('mjs'),
        buildSrcTree('cjs'),
        runTsc('tsconfig.types.json'),
      ])
    ).every((status) => status);

    if (!success) {
      throw new Error(`Failed to build ${packageJson.name}`);
    }

    await writeSubPackageJson(packageJson, 'dist/cjs', 'commonjs');
    await writeSubPackageJson(packageJson, 'dist/mjs', 'module');
    await rewriteCjsRelativeSpecifiers();
    await writePublishPackageJson(packageJson);

    console.log('  ✅ CJS bundle created');
    console.log('  ✅ MJS bundle created');
    console.log('  ✅ package.json updated for publishing');
    console.log(`✨ Finished building ${packageJson.name} v${packageJson.version}`);
  } finally {
    await cleanupBuildTsconfigs();
  }
};

main().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
