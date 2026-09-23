import ts from 'typescript';
import { resolve, relative, isAbsolute } from 'node:path';
export function importsOf(source, filename = 'module.ts') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const value = node.arguments[0];
      imports.push(value && ts.isStringLiteral(value) ? value.text : '<dynamic-import>');
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return imports;
}
export function domainViolations(source, directory = 'packages/domain/src') {
  return importsOf(source).filter((value) => {
    if (!value.startsWith('./') && !value.startsWith('../')) return true;
    const location = relative(resolve('packages/domain/src'), resolve(directory, value));
    return location.startsWith('..') || isAbsolute(location);
  });
}
export const clientForbidden =
  /^(?:@ayra\/(?:config|auth|billing|agent-runtime|model-gateway|tool-gateway|sandbox)|@clerk\/backend|@aws-sdk\/|@temporalio\/|@openai\/agents|openai$|e2b$|node:)/;
