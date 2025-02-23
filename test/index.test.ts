import path from 'path';
import fs from 'fs';

import glob from 'glob';
import prettier from 'prettier';
import * as ttp from '../src';
import { TestOptions } from './types';

const prettierConfig = prettier.resolveConfig.sync(path.join(__dirname, '../.prettierrc'));

const testCases = glob.sync('**/input.{d.ts,ts,tsx}', { absolute: true, cwd: __dirname });

const tsModesConfigs = {
	'default Typescript config': '../tsconfig.json',
	'strict mode disabled': './tsconfig.nostrict.json',
};

for (const [mode, configRelativePath] of Object.entries(tsModesConfigs)) {
	describe(`given ${mode}`, () => {
		// Create program for all files to speed up tests
		const program = ttp.createProgram(
			testCases,
			ttp.loadConfig(path.resolve(__dirname, configRelativePath))
		);

		for (const testCase of testCases) {
			const dirname = path.dirname(testCase);
			const testName = dirname.substr(__dirname.length + 1);
			const astPath = path.join(dirname, 'output.json');
			const outputPath = path.join(dirname, 'output.js');
			const optionsPath = path.join(dirname, 'options.ts');
			const inputJS = path.join(dirname, 'input.js');

			it(testName, () => {
				const options: TestOptions = fs.existsSync(optionsPath) ? require(optionsPath).default : {};

				const ast = ttp.parseFromProgram(testCase, program, options.parser);

				//#region Check AST matches
				// propsFilename will be different depending on where the project is on disk
				// Manually check that it's correct and then delete it
				const newAST = ttp.programNode(
					ast.body.map((component) => {
						expect(component.propsFilename).toBe(testCase);
						return { ...component, propsFilename: undefined };
					})
				);

				if (fs.existsSync(astPath)) {
					expect(newAST).toMatchObject(JSON.parse(fs.readFileSync(astPath, 'utf8')));
				} else {
					fs.writeFileSync(
						astPath,
						prettier.format(
							JSON.stringify(newAST, (key, value) => {
								// These are TypeScript internals that change depending on the number of symbols created during test
								if (key === '$$id') {
									return undefined;
								}
								return value;
							}),
							{
								...prettierConfig,
								filepath: astPath,
							}
						)
					);
				}
				//#endregion

				let inputSource: string | null = null;
				if (testCase.endsWith('.d.ts')) {
					try {
						inputSource = fs.readFileSync(inputJS, 'utf8');
					} catch (error) {}
				} else {
					inputSource = ttp.ts.transpileModule(fs.readFileSync(testCase, 'utf8'), {
						compilerOptions: {
							target: ttp.ts.ScriptTarget.ESNext,
							jsx: ttp.ts.JsxEmit.Preserve,
						},
					}).outputText;
				}

				let result = '';
				// For d.ts files we just generate the AST
				if (!inputSource) {
					result = ttp.generate(ast, options.generator);
				}
				// For .tsx? files we transpile them and inject the proptypes
				else {
					const injected = ttp.inject(ast, inputSource, options.injector);
					if (!injected) {
						throw new Error('Injection failed');
					}

					result = injected;
				}

				//#region Check generated and/or injected proptypes
				const propTypes = prettier.format(result, {
					...prettierConfig,
					filepath: outputPath,
				});

				if (fs.existsSync(outputPath)) {
					expect(propTypes.replace(/\r?\n/g, '\n')).toMatch(
						fs.readFileSync(outputPath, 'utf8').replace(/\r?\n/g, '\n')
					);
				} else {
					fs.writeFileSync(outputPath, propTypes);
				}
				//#endregion
			});
		}
	});
}
