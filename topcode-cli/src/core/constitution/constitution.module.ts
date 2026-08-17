import { Module } from '@nestjs/common';
import { ConstitutionLoader } from './constitution.loader';
import { ConstitutionInjector } from './constitution.injector';
import { ConstitutionGuard } from './constitution.guard';

@Module({
  providers: [ConstitutionLoader, ConstitutionInjector, ConstitutionGuard],
  exports: [ConstitutionLoader, ConstitutionInjector, ConstitutionGuard],
})
export class ConstitutionModule {}
