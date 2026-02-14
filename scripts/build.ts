import path from 'node:path';
import { $, Glob } from 'bun';

const __dirname = import.meta.dirname;
const packageDir = path.join(__dirname, '..');
const packageJsonPath = path.join(packageDir, 'package.json');

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

            content = content.replace(
              /((?:im|ex)port\s[\w{}/*\s,]+from\s['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
              `$1.${extension}`,
            );

            content = content.replace(
              /(import\(['"](?:\.\.?\/)+[^'"]+?)(?:\.tsx?)?(?=['"])/gm,
              `$1.${extension}`,
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

const writeSubPackageJson = async (folder: string, type: 'commonjs' | 'module') => {
  const packageJson = await Bun.file(path.join(packageDir, 'package.json')).json();
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

const main = async () => {
  const originalPackageJsonText = await Bun.file(packageJsonPath).text();
  const packageJson = JSON.parse(originalPackageJsonText) as { name: string; version: string };

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

    await writeSubPackageJson('dist/cjs', 'commonjs');
    await writeSubPackageJson('dist/mjs', 'module');

    console.log('  ✅ CJS bundle created');
    console.log('  ✅ MJS bundle created');
    console.log(`✨ Finished building ${packageJson.name} v${packageJson.version}`);
  } finally {
    await cleanupBuildTsconfigs();
    const currentPackageJsonText = await Bun.file(packageJsonPath).text();
    if (currentPackageJsonText !== originalPackageJsonText) {
      await Bun.write(packageJsonPath, originalPackageJsonText);
      console.log('  ✅ package.json restored');
    }
  }
};

main().catch((error) => {
  console.error('❌ Build failed:', error);
  process.exit(1);
});
